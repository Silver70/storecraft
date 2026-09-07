import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  FolderIcon,
  FolderPlusIcon,
  PencilIcon,
  StoreIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import type { Category } from "~/types/api";

type FlatRow = { category: Category; depth: number };

function flatten(cats: Category[], depth = 0): FlatRow[] {
  return cats.flatMap((c) => [
    { category: c, depth },
    ...flatten(c.children, depth + 1),
  ]);
}

export function CategoryTree({
  categories,
  onEdit,
  onAddChild,
  onDelete,
  deletingId,
}: {
  categories: Category[];
  onEdit: (category: Category) => void;
  onAddChild: (parent: Category) => void;
  onDelete: (category: Category) => void;
  deletingId: string | null;
}) {
  const rows = flatten(categories);

  return (
    <div className="divide-y rounded-lg border">
      {rows.map(({ category, depth }) => (
        <CategoryRow
          key={category.id}
          category={category}
          depth={depth}
          onEdit={() => onEdit(category)}
          onAddChild={() => onAddChild(category)}
          onDelete={() => onDelete(category)}
          isDeleting={deletingId === category.id}
        />
      ))}
    </div>
  );
}

function CategoryRow({
  category,
  depth,
  onEdit,
  onAddChild,
  onDelete,
  isDeleting,
}: {
  category: Category;
  depth: number;
  onEdit: () => void;
  onAddChild: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const childCount = category.children.length;

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30"
      style={{ paddingLeft: 16 + depth * 24 }}
    >
      {depth > 0 && (
        <span className="-ml-3 text-muted-foreground/40 select-none">↳</span>
      )}
      <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{category.name}</p>
          {childCount > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {childCount}
            </span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          /{category.slug}
          {category.description ? ` · ${category.description}` : ""}
        </p>
      </div>

      {confirmDelete ? (
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {childCount > 0
              ? `Delete? ${childCount} subcategor${childCount === 1 ? "y" : "ies"} move up a level.`
              : "Delete this category?"}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => setConfirmDelete(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-7 bg-destructive px-2.5 text-xs text-destructive-foreground hover:bg-destructive/90"
            onClick={onDelete}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting…" : "Delete"}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            asChild
            title="Edit in Store"
          >
            <Link
              to="/admin/store"
              search={{
                categorySlug: category.slug,
                returnTo: "/admin/categories",
              }}
            >
              <StoreIcon className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={onAddChild}
            title="Add subcategory"
          >
            <FolderPlusIcon className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Subcategory</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            onClick={onEdit}
            title="Edit category"
          >
            <PencilIcon className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
            title="Delete category"
          >
            <Trash2Icon className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
