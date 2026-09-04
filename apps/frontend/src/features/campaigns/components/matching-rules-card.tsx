import * as React from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { LoaderCircleIcon, LockIcon, PlusIcon, XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  CAMPAIGN_RULE_FIELDS,
  CAMPAIGN_RULE_OPERATORS,
  type CampaignMatchingRule,
  type CampaignRuleField,
  type CampaignRuleOperator,
} from "~/types/api";
import { campaignRulesQueryOptions } from "../queries";
import {
  createCampaignRuleServerFn,
  deleteCampaignRuleServerFn,
} from "../server";
import {
  RULE_FIELD_LABELS,
  RULE_OPERATOR_LABELS,
  RULE_VALUE_PLACEHOLDERS,
} from "../utils";

/**
 * The rules that teach a campaign to recognise the links the merchant actually
 * sent out.
 *
 * The screen leans on one fact throughout: matching normalizes both sides, so
 * `summer_sale`, `Summer-Sale` and `summer sale` are the same rule. A merchant
 * who does not know that writes three rules, gets refused as a duplicate, and
 * has no idea why — so the card says it up front and the duplicate error
 * repeats it.
 */
export function MatchingRulesCard({ campaignId }: { campaignId: string }) {
  const queryClient = useQueryClient();
  const { data: rules = [], isPending } = useQuery(
    campaignRulesQueryOptions(campaignId),
  );

  const [field, setField] = React.useState<CampaignRuleField>("utm_campaign");
  const [operator, setOperator] = React.useState<CampaignRuleOperator>("equals");
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["campaigns", "detail", campaignId, "rules"],
    });

  const addMutation = useMutation({
    mutationFn: () =>
      createCampaignRuleServerFn({
        data: { campaignId, field, operator, value: value.trim() },
      }),
    onSuccess: () => {
      setValue("");
      setError(null);
      void invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (ruleId: string) =>
      deleteCampaignRuleServerFn({ data: { campaignId, ruleId } }),
    onSuccess: () => {
      setError(null);
      void invalidate();
    },
    onError: (err) => setError(err.message),
  });

  const canAdd = value.trim().length > 0 && !addMutation.isPending;

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Matching Rules
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <p className="text-xs text-muted-foreground">
          A visit is attributed to this campaign when it matches any rule below.
          Matching ignores case, hyphens, underscores and spacing, so{" "}
          <code>summer_sale</code>, <code>Summer-Sale</code> and{" "}
          <code>summer sale</code> are all one rule. Adding a rule also repairs
          past reports — orders are matched when a report is read, not when they
          were placed.
        </p>

        {/* ── Existing rules ──────────────────────────────────────────────── */}
        {isPending ? (
          <p className="text-xs text-muted-foreground">Loading rules…</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onRemove={() => removeMutation.mutate(rule.id)}
                removing={
                  removeMutation.isPending &&
                  removeMutation.variables === rule.id
                }
              />
            ))}
          </ul>
        )}

        {/* ── Add a rule ──────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <Label htmlFor="rule-value">Add a rule</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={field}
              onValueChange={(next) => setField(next as CampaignRuleField)}
            >
              <SelectTrigger className="w-[220px]" aria-label="Field">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAMPAIGN_RULE_FIELDS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {RULE_FIELD_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={operator}
              onValueChange={(next) => setOperator(next as CampaignRuleOperator)}
            >
              <SelectTrigger className="w-[130px]" aria-label="Operator">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAMPAIGN_RULE_OPERATORS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {RULE_OPERATOR_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              id="rule-value"
              className="min-w-[180px] flex-1"
              placeholder={RULE_VALUE_PLACEHOLDERS[field]}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canAdd) addMutation.mutate();
              }}
            />

            <Button
              type="button"
              className="gap-1.5"
              disabled={!canAdd}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending ? (
                <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PlusIcon className="h-3.5 w-3.5" />
              )}
              Add
            </Button>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <p className="text-xs text-muted-foreground">
            If two campaigns could claim the same visit, a campaign-tag rule
            wins over a source or medium rule, which win over a referring site;
            an exact match wins over a prefix. The same visit always reports
            against the same campaign.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function RuleRow({
  rule,
  onRemove,
  removing,
}: {
  rule: CampaignMatchingRule;
  onRemove: () => void;
  removing: boolean;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <span className="text-muted-foreground">
        {RULE_FIELD_LABELS[rule.field]}
      </span>
      <span className="text-xs text-muted-foreground">
        {RULE_OPERATOR_LABELS[rule.operator]}
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-sm">
        {rule.value}
      </code>

      {rule.isCanonical ? (
        <span
          className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
          // Removing it would unattribute every link already generated from
          // this campaign, all of which carry the tag.
          title="This campaign's own tag. Generated links carry it, so it cannot be removed."
        >
          <LockIcon className="h-3 w-3" />
          Campaign tag
        </span>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={`Remove rule ${rule.value}`}
          disabled={removing}
          onClick={onRemove}
        >
          {removing ? (
            <LoaderCircleIcon className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <XIcon className="h-3.5 w-3.5" />
          )}
        </Button>
      )}
    </li>
  );
}
