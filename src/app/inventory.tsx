import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { useQtyLabel } from '@/components/sale';
import { Btn, Card, Empty, Field, Row, Screen, T, Tag } from '@/components/ui';
import { fmtMoney, searchProducts, stockStatus } from '@/lib/engine';
import { useT, useUnit } from '@/lib/i18n';
import { useApp } from '@/lib/store';

export default function Inventory() {
  const t = useT();
  const unit = useUnit();
  const router = useRouter();
  const qtyLabel = useQtyLabel();
  const app = useApp();
  const [q, setQ] = useState('');
  const list = useMemo(() => searchProducts(app.products, q), [app.products, q]);

  return (
    <Screen title={t('stock')}>
      <Row>
        <Btn kind="outline" label={t('scanBarcode')} onPress={() => router.push('/scan')} style={{ flex: 1 }} />
        <Btn label={t('addProduct')} onPress={() => router.push('/product/new')} style={{ flex: 1 }} />
      </Row>
      <Field label={t('searchLabel')} placeholder={t('searchPlaceholder')} value={q} onChangeText={setQ} autoCorrect={false} autoCapitalize="none" />

      {list.length === 0 ? <Empty title={t('noProduct')} hint={t('noProductHint')} /> : null}
      {list.map((p) => {
        const st = stockStatus(p);
        return (
          <Card key={p.id}>
            <T v="sub">{p.name}</T>
            <T c="ash">
              {p.pack ? `${p.pack} · ` : ''}
              {unit(p.unit)} · {fmtMoney(p.pricePaise)}
            </T>
            <Row style={{ flexWrap: 'wrap' }}>
              <T v="h3">{qtyLabel(p.stock, p.unit)}</T>
              <Tag label={st === 'OUT' ? t('outOfStock') : st === 'LOW' ? t('lowStock') : t('inStock')} kind={st === 'OK' ? 'plain' : 'alert'} />
            </Row>
            <Btn kind="outline" label={t('restock')} onPress={() => router.push(`/product/${p.id}`)} />
          </Card>
        );
      })}
    </Screen>
  );
}
