import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { NoSale, useDraft, useQtyLabel } from '@/components/sale';
import { Btn, Card, Empty, Field, Row, Screen, T, Tag } from '@/components/ui';
import { fmtMoney, saleTotal, searchProducts, stockStatus } from '@/lib/engine';
import { useT, useUnit } from '@/lib/i18n';
import { actions } from '@/lib/store';

export default function Search() {
  const t = useT();
  const unit = useUnit();
  const router = useRouter();
  const qtyLabel = useQtyLabel();
  const { replace } = useLocalSearchParams<{ replace?: string }>();
  const { id, app, sale } = useDraft();
  const [q, setQ] = useState('');
  const results = useMemo(() => searchProducts(app.products, q), [app.products, q]);

  if (!sale) return <NoSale title={t('findProduct')} />;

  const pick = (productId: string) => {
    if (replace) {
      actions.replaceItem(sale.id, replace, productId);
      router.back();
    } else {
      actions.addItem(sale.id, productId);
    }
  };

  return (
    <Screen
      title={replace ? t('replaceProduct') : t('findProduct')}
      footer={
        sale.items.length && !replace ? (
          <Btn label={`${t('reviewBill')} · ${fmtMoney(saleTotal(sale.items))}`} onPress={() => router.push(`/sale/${id}/review`)} />
        ) : undefined
      }>
      <Field
        label={t('searchLabel')}
        placeholder={t('searchPlaceholder')}
        value={q}
        onChangeText={setQ}
        autoFocus
        autoCorrect={false}
        autoCapitalize="none"
      />
      {q && results.length > 1 ? <T c="ash">{t('severalMatches')}</T> : null}

      {results.length === 0 ? (
        <>
          <Empty title={t('noProduct')} hint={t('noProductHint')} />
          <Btn kind="outline" label={t('addNewProduct')} onPress={() => router.push(`/product/new?name=${encodeURIComponent(q)}`)} />
        </>
      ) : (
        results.map((p) => {
          const inBill = sale.items.find((i) => i.productId === p.id);
          const st = stockStatus(p);
          return (
            <Card key={p.id}>
              <T v="sub">{p.name}</T>
              <T c="ash">
                {p.pack ? `${p.pack} · ` : ''}
                {unit(p.unit)}
              </T>
              <Row style={{ flexWrap: 'wrap' }}>
                <T v="h3">{fmtMoney(p.pricePaise)}</T>
                <Tag label={st === 'OUT' ? t('outOfStock') : `${t('stockLabel')} ${qtyLabel(p.stock, p.unit)}`} kind={st === 'OK' ? 'plain' : 'alert'} />
                {inBill ? <Tag label={`${t('inBill')} ${qtyLabel(inBill.qty, inBill.unit)}`} kind="active" /> : null}
              </Row>
              <View>
                <Btn label={replace ? t('useThis') : t('add')} onPress={() => pick(p.id)} />
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}
