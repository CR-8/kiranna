import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList } from 'react-native';

import { ProductRow } from '@/components/sale';
import { RestockForm } from '@/components/restock';
import { Btn, Empty, Field, Row, Screen } from '@/components/ui';
import { searchProducts, type Product } from '@/lib/engine';
import { useT } from '@/lib/i18n';
import { useApp } from '@/lib/store';

/** SCAN BARCODE · SEARCH PRODUCT · ADD NEW PRODUCT. RESTOCK happens in place, no extra screen. */
export default function Inventory() {
  const t = useT();
  const router = useRouter();
  const app = useApp();
  const [q, setQ] = useState('');
  const [restocking, setRestocking] = useState<Product | null>(null);
  const list = useMemo(() => searchProducts(app.products, q), [app.products, q]);

  if (restocking)
    return (
      <Screen title={t('restockTitle')} tab="stock" back={false}>
        <RestockForm p={restocking} onDone={() => setRestocking(null)} onCancel={() => setRestocking(null)} />
      </Screen>
    );

  return (
    <Screen title={t('stock')} tab="stock" back={false} scroll={false}>
      <Row>
        <Btn label={t('scanBarcode')} onPress={() => router.push('/scan')} style={{ flex: 1 }} />
        <Btn kind="outline" label={t('addProduct')} onPress={() => router.push('/product/new')} style={{ flex: 1 }} />
      </Row>
      <Field label={t('searchLabel')} placeholder={t('searchPlaceholder')} value={q} onChangeText={setQ} autoCorrect={false} autoCapitalize="none" />
      <FlatList
        style={{ flex: 1 }}
        data={list}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Empty title={t('noProduct')} hint={t('noProductHint')} />}
        renderItem={({ item }) => <ProductRow p={item} action={t('restock')} onPress={() => setRestocking(item)} />}
      />
    </Screen>
  );
}
