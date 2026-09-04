import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  Campaign,
  CampaignMatchingRule,
  CampaignPlatform,
  CampaignRuleField,
  CampaignRuleOperator,
  CampaignStatus,
} from '../../../shared/database/schema';
import { CampaignRepository } from '../repositories/campaign.repository';
import {
  campaignTagCandidate,
  deriveCampaignTag,
} from '../utils/campaign-tag.util';
import {
  createCampaignMatcher,
  normalizeMatchValue,
  referrerHost,
  type CampaignMatcher,
} from '../utils/campaign-matching.util';
import {
  buildTaggedLink,
  DEFAULT_STOREFRONT_URL,
  type TaggedLink,
  type TaggedLinkProblem,
} from '../utils/tagged-link.util';

export interface CreateCampaignInput {
  name: string;
  platform: CampaignPlatform;
  externalId?: string | null;
}

export interface UpdateCampaignInput {
  name?: string;
  platform?: CampaignPlatform;
  externalId?: string | null;
}

export interface CreateCampaignRuleInput {
  field: CampaignRuleField;
  operator: CampaignRuleOperator;
  value: string;
}

export interface GenerateCampaignLinkInput {
  /** A page of the store. Defaults to its home page. */
  destination?: string;
  source: string;
  medium: string;
  content?: string | null;
}

export interface CampaignTaggedLink extends TaggedLink {
  campaignId: string;
  campaignName: string;
}

/**
 * Why a link could not be composed, said in the merchant's terms. A generated
 * link is a convenience, so a refusal has to explain what to type instead
 * rather than send them back to composing UTM parameters by hand.
 */
const LINK_PROBLEM_MESSAGES: Record<TaggedLinkProblem, string> = {
  destination:
    'A destination must be a page of your store — a path like /products/summer-tee, or a full https:// URL.',
  source:
    'A source must contain at least one letter or number — it names where the link is being placed, such as instagram.',
  medium:
    'A medium must contain at least one letter or number — it names the kind of placement, such as paid_social.',
  content:
    'A content label must contain at least one letter or number, or be left empty.',
  campaignTag:
    'This campaign has no usable tag, so no link can be generated from it.',
};

/** How many tags to try before giving up on finding a free one. */
const MAX_TAG_ATTEMPTS = 25;

const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === UNIQUE_VIOLATION;
}

/**
 * What to store for a rule the merchant typed.
 *
 * Values are stored as written rather than normalized, so the rules screen shows
 * the merchant their own words back; normalization happens on both sides at
 * comparison time. The one exception is a referrer host, where a merchant
 * pastes the link they were given — `https://www.instagram.com/p/abc/` — and
 * means the host it is on.
 */
function canonicalizeRuleValue(
  field: CampaignRuleField,
  value: string,
): string {
  const trimmed = value.trim();
  if (field !== 'referrer_host') return trimmed;
  return referrerHost(trimmed) ?? trimmed;
}

/**
 * Campaigns — the things a merchant spends money on, and the unit revenue is
 * attributed to.
 *
 * Two properties are worth stating outright, because both are load-bearing and
 * neither is obvious from the CRUD:
 *
 * A Campaign's canonical tag is assigned once and never changes, including on
 * rename. The tag is what generated links carry into ad platforms, and a link
 * already live cannot be recalled — re-deriving it from a new name would orphan
 * every ad running under the old one.
 *
 * A Campaign cannot be deleted, only archived. Attribution is resolved from a
 * Campaign's matching rules at read time (ADR-0001), so removing the row would
 * silently move revenue that has already been reported into Unattributed.
 * Archiving takes it out of the active list and leaves its history intact.
 */
@Injectable()
export class CampaignService {
  constructor(
    private readonly campaigns: CampaignRepository,
    private readonly config: ConfigService,
  ) {}

  async list(
    orgId: string,
    storeId: string,
    status?: CampaignStatus,
  ): Promise<Campaign[]> {
    return this.campaigns.findMany(orgId, storeId, status);
  }

  async get(orgId: string, storeId: string, id: string): Promise<Campaign> {
    const campaign = await this.campaigns.findById(id, orgId, storeId);
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  /**
   * Creates a Campaign, its canonical tag, and the exact-match rule on that tag.
   *
   * The rule is created here rather than left to the merchant so that a link the
   * admin generates is attributed by construction — matching a campaign you just
   * made should never require authoring a rule first, and a merchant who never
   * opens the rules screen still gets correct reports.
   */
  async create(
    orgId: string,
    storeId: string,
    input: CreateCampaignInput,
  ): Promise<Campaign> {
    const name = input.name.trim();
    const base = deriveCampaignTag(name);
    const externalId = input.externalId?.trim() || null;

    // The exists check picks a readable tag; the retry handles the case where
    // another request claimed it between the check and the insert. The unique
    // constraint, not this loop, is what actually guarantees uniqueness.
    let campaign: Campaign | undefined;
    for (let attempt = 1; attempt <= MAX_TAG_ATTEMPTS; attempt++) {
      const tag = campaignTagCandidate(base, attempt);
      if (await this.campaigns.tagExists(tag, orgId, storeId)) continue;

      try {
        campaign = await this.campaigns.create({
          organizationId: orgId,
          storeId,
          name,
          tag,
          platform: input.platform,
          externalId,
          status: 'active',
        });
        break;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }

    if (!campaign) {
      throw new ConflictException(
        `Could not assign a unique tag for "${name}" — try a more distinctive name.`,
      );
    }

    await this.campaigns.createRule({
      organizationId: orgId,
      storeId,
      campaignId: campaign.id,
      field: 'utm_campaign',
      operator: 'equals',
      value: campaign.tag,
      isCanonical: true,
    });

    return campaign;
  }

  /**
   * Updates the merchant-owned fields. The tag and the status are deliberately
   * not among them: the tag is immutable, and the status moves only through
   * archive/unarchive so the intent is explicit in the request.
   */
  async update(
    orgId: string,
    storeId: string,
    id: string,
    input: UpdateCampaignInput,
  ): Promise<Campaign> {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.platform !== undefined) patch.platform = input.platform;
    if (input.externalId !== undefined) {
      patch.externalId = input.externalId?.trim() || null;
    }

    if (Object.keys(patch).length === 0) return this.get(orgId, storeId, id);

    const updated = await this.campaigns.update(id, orgId, storeId, patch);
    if (!updated) throw new NotFoundException('Campaign not found');
    return updated;
  }

  async archive(orgId: string, storeId: string, id: string): Promise<Campaign> {
    const updated = await this.campaigns.update(id, orgId, storeId, {
      status: 'archived',
      archivedAt: new Date(),
    });
    if (!updated) throw new NotFoundException('Campaign not found');
    return updated;
  }

  async unarchive(
    orgId: string,
    storeId: string,
    id: string,
  ): Promise<Campaign> {
    const updated = await this.campaigns.update(id, orgId, storeId, {
      status: 'active',
      archivedAt: null,
    });
    if (!updated) throw new NotFoundException('Campaign not found');
    return updated;
  }

  // ─── Tagged links ───────────────────────────────────────────────────────────

  /**
   * Composes the tagged URL a merchant pastes into an ad platform.
   *
   * The link carries the Campaign's own canonical tag, which the Campaign's
   * canonical rule already matches, so traffic arriving through it is attributed
   * without a rule being authored and without a UTM string being typed
   * correctly. Several links differing only by source or medium therefore all
   * report as one Campaign, which is what lets one push run on more than one
   * platform.
   *
   * Nothing is persisted: a link is derived from the Campaign, so generating the
   * same one twice gives the same URL, and a link tagged by hand before the
   * Campaign existed is still claimable by a rule. The generator is a
   * convenience, not a precondition.
   *
   * An archived Campaign can still generate one — a finished push is sometimes
   * revived, and refusing would be a surprise with no safety behind it.
   */
  async generateLink(
    orgId: string,
    storeId: string,
    id: string,
    input: GenerateCampaignLinkInput,
  ): Promise<CampaignTaggedLink> {
    const campaign = await this.get(orgId, storeId, id);

    const result = buildTaggedLink({
      baseUrl: this.storefrontUrl(),
      destination: input.destination ?? '/',
      campaignTag: campaign.tag,
      source: input.source,
      medium: input.medium,
      content: input.content ?? null,
    });

    if (!result.ok) {
      throw new BadRequestException(LINK_PROBLEM_MESSAGES[result.problem]);
    }

    return {
      ...result.link,
      campaignId: campaign.id,
      campaignName: campaign.name,
    };
  }

  /**
   * The storefront a destination path is resolved against — the same base the
   * rest of the engine builds customer-facing links from. A store on its own
   * domain is served by passing that domain as an absolute destination.
   */
  private storefrontUrl(): string {
    return this.config.get<string>('STOREFRONT_URL', DEFAULT_STOREFRONT_URL);
  }

  // ─── Matching rules ─────────────────────────────────────────────────────────

  /**
   * The rules that teach a Campaign to recognise the links the merchant actually
   * sent out — the canonical one it was created with, plus whatever variants
   * their tagging turned out to use.
   */
  async listRules(
    orgId: string,
    storeId: string,
    campaignId: string,
  ): Promise<CampaignMatchingRule[]> {
    await this.get(orgId, storeId, campaignId);
    return this.campaigns.findRulesForCampaign(campaignId, orgId, storeId);
  }

  /**
   * Adds a rule. Because matching compares normalized values, a rule is a
   * duplicate when it *means* the same as an existing one, not only when it
   * reads the same: `Summer_Sale` and `summer-sale` are one rule, and telling
   * the merchant so is more use than storing a second row that can never win.
   */
  async addRule(
    orgId: string,
    storeId: string,
    campaignId: string,
    input: CreateCampaignRuleInput,
  ): Promise<CampaignMatchingRule> {
    await this.get(orgId, storeId, campaignId);

    const value = canonicalizeRuleValue(input.field, input.value);
    const normalized = normalizeMatchValue(value);
    if (normalized === null) {
      throw new BadRequestException(
        'A rule value must contain at least one letter or number — punctuation alone can never match a visit.',
      );
    }

    const existing = await this.campaigns.findRulesForCampaign(
      campaignId,
      orgId,
      storeId,
    );
    const duplicate = existing.some(
      (rule) =>
        rule.field === input.field &&
        rule.operator === input.operator &&
        normalizeMatchValue(rule.value) === normalized,
    );
    if (duplicate) {
      throw new ConflictException(
        'This campaign already matches that value — matching ignores case, hyphens, underscores and spacing.',
      );
    }

    try {
      return await this.campaigns.createRule({
        organizationId: orgId,
        storeId,
        campaignId,
        field: input.field,
        operator: input.operator,
        value,
        isCanonical: false,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'This campaign already matches that value.',
        );
      }
      throw error;
    }
  }

  /**
   * Removes a merchant-authored rule.
   *
   * The canonical rule is not among them: it matches the Campaign's own tag,
   * which every link generated from the Campaign carries, so removing it would
   * silently unattribute every ad already running under it.
   */
  async removeRule(
    orgId: string,
    storeId: string,
    campaignId: string,
    ruleId: string,
  ): Promise<void> {
    await this.get(orgId, storeId, campaignId);

    const rule = await this.campaigns.findRuleById(
      ruleId,
      campaignId,
      orgId,
      storeId,
    );
    if (!rule) throw new NotFoundException('Matching rule not found');

    if (rule.isCanonical) {
      throw new ConflictException(
        "A campaign's own tag rule cannot be removed — every link generated from this campaign carries that tag.",
      );
    }

    await this.campaigns.deleteRule(ruleId, campaignId, orgId, storeId);
  }

  /**
   * A matcher over every rule in one Store.
   *
   * Tenancy is enforced here, at the load: the matcher itself is pure and will
   * faithfully match whatever rules it is handed, so the only thing standing
   * between one merchant's traffic and another merchant's Campaigns is that this
   * read is scoped to a single Organization and Store.
   */
  async buildMatcher(orgId: string, storeId: string): Promise<CampaignMatcher> {
    const rules = await this.campaigns.findMatchableRules(orgId, storeId);
    return createCampaignMatcher(rules);
  }
}
