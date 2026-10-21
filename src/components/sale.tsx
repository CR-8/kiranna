import { useLocalSearchParams, useRouter } from 'expo-router';

import { Btn, Empty, Screen } from '@/components/ui';
import { useT, useUnit } from '@/lib/i18n';
import { fmtQty, type Unit } from '@/lib/engine';
import { useApp } from '@/lib/store';

/** The open draft for the current /sale/[id]/* route, or undefined once it is confirmed/discarded. */
export function useDraft() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApp();
  const sale = app.sales.find((s) => s.id === id);
  return { id, app, sale: sale?.status === 'draft' ? sale : undefined };
}

export function NoSale({ title }: { title: string }) {
  const t = useT();
  const router = useRouter();
  return (
    <Screen title={title}>
      <Empty title={t('saleGone')} hint={t('saleGoneHint')} />
      <Btn label={t('goHome')} onPress={() => router.replace('/')} />
    </Screen>
  );
}

/** "2 pkt", "0.5 kg" */
export function useQtyLabel() {
  const unit = useUnit();
  return (milli: number, u: Unit) => `${fmtQty(milli)} ${unit(u)}`;
}
