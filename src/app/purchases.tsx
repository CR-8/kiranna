import { useRouter } from 'expo-router';
import { FlatList, Pressable } from 'react-native';

import { Btn, Empty, Row, Screen, T, Tag } from '@/components/ui';
import { C } from '@/constants/theme';
import { outstanding } from '@/lib/engine';
import { fmtDateTime, useT } from '@/lib/i18n';
import { useApp } from '@/lib/store';

/** Every restock list and order: open ones first, then what was received. Empty lists are left out. */
export default function Purchases() {
  const t = useT();
  const router = useRouter();
  const app = useApp();
  const rank = { list: 0, ordered: 1, closed: 2, cancelled: 3 } as const;
  const data = app.purchases
    .filter((p) => p.lines.length || p.status === 'closed')
    .sort((a, b) => rank[a.status] - rank[b.status] || b.createdAt - a.createdAt);

  return (
    <Screen title={t('purchases')} scroll={false} footer={<Btn label={t('restockCenter')} onPress={() => router.push('/restock')} />}>
      <FlatList
        style={{ flex: 1 }}
        data={data}
        keyExtractor={(p) => p.id}
        ListEmptyComponent={<Empty title={t('noPurchases')} hint={t('noPurchasesHint')} />}
        renderItem={({ item: p }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/purchase/${p.id}`)}
            style={({ pressed }) => ({ minHeight: 68, paddingVertical: 10, justifyContent: 'center', gap: 2, borderBottomWidth: 1, borderColor: C.hairline, opacity: pressed ? 0.75 : 1 })}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T v="sub">{fmtDateTime(p.createdAt)}</T>
              <Tag label={t(`ps_${p.status}`)} kind={p.status === 'closed' ? 'active' : 'plain'} />
            </Row>
            <T c="ash">
              {t('linesCount', { n: p.lines.length })} · {t('stillWaiting', { n: p.lines.filter((l) => outstanding(l) > 0).length })}
            </T>
          </Pressable>
        )}
      />
    </Screen>
  );
}
