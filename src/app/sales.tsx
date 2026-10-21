import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Btn, Card, Empty, Row, Screen, T } from '@/components/ui';
import { fmtMoney, openDrafts, saleTotal } from '@/lib/engine';
import { useT } from '@/lib/i18n';
import { actions, useApp } from '@/lib/store';

export default function Sales() {
  const t = useT();
  const router = useRouter();
  const app = useApp();
  const drafts = openDrafts(app);
  const [closing, setClosing] = useState<string | null>(null);

  return (
    <Screen title={t('openSales')} footer={<Btn label={t('newSale')} onPress={() => router.replace(`/sale/${actions.startSale()}`)} />}>
      {drafts.length === 0 ? <Empty title={t('noOpenSales')} hint={t('noOpenSalesHint')} /> : null}
      {drafts.map((d) => (
        <Card key={d.id}>
          <T v="h3">{t('saleN', { n: d.label })}</T>
          <Row style={{ justifyContent: 'space-between' }}>
            <T c="ash">{t('itemsCount', { n: d.items.length })}</T>
            <T v="h3">{fmtMoney(saleTotal(d.items))}</T>
          </Row>
          {closing === d.id ? (
            <>
              <T v="sub">{t('closeAsk')}</T>
              <Row>
                <Btn kind="outline" label={t('closeYes')} onPress={() => { actions.discardSale(d.id); setClosing(null); }} style={{ flex: 1 }} />
                <Btn kind="wash" label={t('keep')} onPress={() => setClosing(null)} style={{ flex: 1 }} />
              </Row>
            </>
          ) : (
            <Row>
              <Btn label={t('openSale')} onPress={() => router.replace(`/sale/${d.id}`)} style={{ flex: 1 }} />
              <Btn kind="wash" label={t('closeDraft')} onPress={() => (d.items.length ? setClosing(d.id) : actions.discardSale(d.id))} style={{ flex: 1 }} />
            </Row>
          )}
        </Card>
      ))}
    </Screen>
  );
}
