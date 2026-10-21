import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList } from 'react-native';

import { NoSale, ProductRow, useDraft } from '@/components/sale';
import { Btn, Empty, Field, Screen, T } from '@/components/ui';
import { recentProducts, searchProducts } from '@/lib/engine';
import { useT } from '@/lib/i18n';
import { actions } from '@/lib/store';

/** Pick one product, land back on the same bill. Empty search shows recent sales, never the whole catalog. */
export default function Search() {
  const t = useT();
  const router = useRouter();
  const { replace } = useLocalSearchParams<{ replace?: string }>();
  const { app, sale } = useDraft();
  const [q, setQ] = useState('');
  const results = useMemo(
    () => (q.trim() ? searchProducts(app.products, q).slice(0, 30) : recentProducts(app, 12)),
    [app, q],
  );

  if (!sale) return <NoSale title={t('findProduct')} />;

  const pick = (productId: string) => {
    if (replace) actions.replaceItem(sale.id, replace, productId);
    else actions.addItem(sale.id, productId);
    router.back();
  };

  return (
    <Screen title={replace ? t('replaceProduct') : t('findProduct')} scroll={false}>
      <Field
        label={t('searchLabel')}
        placeholder={t('searchPlaceholder')}
        value={q}
        onChangeText={setQ}
        autoFocus
        autoCorrect={false}
        autoCapitalize="none"
      />
      <FlatList
        style={{ flex: 1 }}
        data={results}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          q.trim() ? (results.length > 1 ? <T c="ash">{t('severalMatches')}</T> : undefined) : <T v="caption" c="ash">{t('recent')}</T>
        }
        ListEmptyComponent={
          <>
            <Empty title={t('noProduct')} hint={t('noProductHint')} />
            <Btn kind="outline" label={t('addNewProduct')} onPress={() => router.push(`/product/new?name=${encodeURIComponent(q)}`)} style={{ marginTop: 12 }} />
          </>
        }
        renderItem={({ item }) => <ProductRow p={item} action={replace ? t('useThis') : t('add')} onPress={() => pick(item.id)} />}
      />
    </Screen>
  );
}
