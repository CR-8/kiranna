import { useRouter } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { NoSale, useDraft } from '@/components/sale';
import { Btn, Card, Row, Screen, SquareBtn, T } from '@/components/ui';
import { useVoiceInput, voiceButtonLabel, VoiceStatus } from '@/components/voice';
import { C, FONT, R } from '@/constants/theme';
import { fmtMoney, fmtQty, lineTotal, parseQty, saleTotal, stepFor } from '@/lib/engine';
import { useT, useUnit } from '@/lib/i18n';
import { actions } from '@/lib/store';

/** Commits on blur/submit; remount via `key` when the stored quantity changes. */
function QtyInput({ value, onCommit }: { value: number; onCommit: (q: number) => void }) {
  const [text, setText] = useState(fmtQty(value));
  const commit = () => {
    const q = parseQty(text);
    if (q) onCommit(q);
    else setText(fmtQty(value));
  };
  return (
    <TextInput
      value={text}
      onChangeText={setText}
      onBlur={commit}
      onSubmitEditing={commit}
      keyboardType="decimal-pad"
      selectTextOnFocus
      accessibilityLabel="quantity"
      style={{
        width: 96,
        height: 56,
        textAlign: 'center',
        fontSize: 24,
        fontFamily: FONT,
        color: C.ink,
        backgroundColor: C.paper,
        borderWidth: 1,
        borderColor: C.smoke,
        borderRadius: R.input,
      }}
    />
  );
}

export default function EditBill() {
  const t = useT();
  const unit = useUnit();
  const router = useRouter();
  const { id, sale } = useDraft();
  // Raw transcript only. Turning it into a correction belongs to the inventory layer.
  const [heard, setHeard] = useState<string | null>(null);
  const voice = useVoiceInput((r) => setHeard(r.transcript));

  if (!sale) return <NoSale title={t('changeBill')} />;
  const total = saleTotal(sale.items);

  return (
    <Screen
      title={t('changeBill')}
      footer={
        <>
          <Row style={{ justifyContent: 'space-between' }}>
            <T v="caption" c="ash">{t('total')}</T>
            <T v="h1">{fmtMoney(total)}</T>
          </Row>
          <Btn label={t('reviewAgain')} onPress={() => router.replace(`/sale/${id}/review`)} disabled={!sale.items.length} />
        </>
      }>
      {sale.items.length === 0 ? <Card wash><T v="sub">{t('billEmpty')}</T></Card> : null}

      {sale.items.map((i) => (
        <Card key={i.id}>
          <T v="sub">{i.name}</T>
          <T c="ash">
            {fmtMoney(i.unitPaise)} / {unit(i.unit)}
          </T>
          <Row style={{ flexWrap: 'wrap' }}>
            <SquareBtn label="−" disabled={i.qty <= stepFor(i.unit)} onPress={() => actions.setQty(sale.id, i.id, i.qty - stepFor(i.unit))} />
            <QtyInput key={i.qty} value={i.qty} onCommit={(q) => actions.setQty(sale.id, i.id, q)} />
            <SquareBtn label="+" onPress={() => actions.setQty(sale.id, i.id, i.qty + stepFor(i.unit))} />
            <T v="caption" c="ash">{unit(i.unit)}</T>
            <View style={{ flex: 1, minWidth: 80, alignItems: 'flex-end' }}>
              <T v="h3">{fmtMoney(lineTotal(i.unitPaise, i.qty))}</T>
            </View>
          </Row>
          <Row>
            <Btn kind="wash" label={t('removeItem')} onPress={() => actions.removeItem(sale.id, i.id)} style={{ flex: 1 }} />
            <Btn kind="wash" label={t('replaceProduct')} onPress={() => router.push(`/sale/${id}/search?replace=${i.id}`)} style={{ flex: 1 }} />
          </Row>
        </Card>
      ))}

      <Row>
        <Btn kind="outline" label={t('addItem')} onPress={() => router.push(`/sale/${id}/search`)} style={{ flex: 1 }} />
        <Btn
          kind={voice.state.status === 'listening' ? 'primary' : 'outline'}
          label={voiceButtonLabel(t, voice.state, t('speakCorrection'))}
          onPress={voice.toggle}
          style={{ flex: 1 }}
        />
      </Row>
      {voice.state.status !== 'idle' || voice.webNote || heard ? <VoiceStatus voice={voice} heard={heard} /> : null}
    </Screen>
  );
}
