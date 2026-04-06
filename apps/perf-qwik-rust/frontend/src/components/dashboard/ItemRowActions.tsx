import { $, component$, type QRL } from "@builder.io/qwik";
import { Button } from "~/components/ui";

export type ItemRowActionsProps = {
  itemId: string;
  /** タイトルは $() 内で参照しない（再開時に陳腐化するため id のみ渡し、親が WASM から解決） */
  onEdit$: QRL<(id: string) => void>;
  onDelete$: QRL<(id: string) => void>;
};

/**
 * 一覧行の編集・削除。クリックは id のみ渡す（$() 内で props.itemTitle を閉じない）。
 */
export const ItemRowActions = component$<ItemRowActionsProps>((props) => {
  return (
    <>
      <Button
        type="button"
        look="outline"
        size="sm"
        class="mr-1"
        onClick$={$(() => props.onEdit$(props.itemId))}
      >
        編集
      </Button>
      <Button
        type="button"
        look="alert"
        size="sm"
        onClick$={$(() => props.onDelete$(props.itemId))}
      >
        削除
      </Button>
    </>
  );
});
