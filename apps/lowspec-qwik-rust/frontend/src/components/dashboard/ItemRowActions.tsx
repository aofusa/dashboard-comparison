import { $, component$, type QRL } from "@builder.io/qwik";
import { Button } from "~/components/ui";

export type ItemRowActionsProps = {
  itemId: string;
  itemTitle: string;
  onEdit$: QRL<(id: string, title: string) => void>;
  onDelete$: QRL<(id: string, title: string) => void>;
};

/**
 * 一覧行の編集・削除。props の id/title と親から渡す QRL のみ参照し、
 * map 内インライン QRL（resume 不安定）を避ける。
 */
export const ItemRowActions = component$<ItemRowActionsProps>((props) => {
  return (
    <>
      <Button
        type="button"
        look="outline"
        size="sm"
        class="mr-1"
        onClick$={$(() =>
          props.onEdit$(props.itemId, props.itemTitle),
        )}
      >
        編集
      </Button>
      <Button
        type="button"
        look="alert"
        size="sm"
        onClick$={$(() =>
          props.onDelete$(props.itemId, props.itemTitle),
        )}
      >
        削除
      </Button>
    </>
  );
});
