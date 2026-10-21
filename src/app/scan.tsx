import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Linking, Platform, View } from 'react-native';

import { useQtyLabel } from '@/components/sale';
import { Btn, Card, Field, Row, Screen, T } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { fmtMoney, findByBarcode, type Product } from '@/lib/engine';
import { useT } from '@/lib/i18n';
import { actions, useApp } from '@/lib/store';

interface Result {
  code: string;
  product?: Product;
  added: boolean;
}

export default function Scan() {
  const t = useT();
  const router = useRouter();
  const qtyLabel = useQtyLabel();
  const app = useApp();
  const { saleId } = useLocalSearchParams<{ saleId?: string }>();
  const [perm, ask] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [manual, setManual] = useState('');
  const [camError, setCamError] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const locked = useRef(false); // one result at a time: the camera fires many events per barcode

  const again = useCallback(() => {
    locked.current = false;
    setRes(null);
    setManual('');
  }, []);
  useFocusEffect(again); // returning from "register product" resumes scanning

  const handle = (raw: string) => {
    const code = raw.trim();
    if (!code || locked.current) return;
    locked.current = true;
    const product = findByBarcode(app.products, code);
    let added = false;
    if (product && saleId) {
      try {
        actions.addItem(saleId, product.id);
        added = true;
      } catch {
        // sale was closed meanwhile: still show the product
      }
    }
    setRes({ code, product, added });
  };

  const granted = perm?.granted;

  return (
    <Screen title={t('scanTitle')} footer={<Btn kind="outline" label={t('cancel')} onPress={() => router.back()} />}>
      {res ? (
        <Card>
          <T v="caption" c="ash">{res.code}</T>
          {res.product ? (
            <>
              <T v="h2">{res.product.name}</T>
              <T v="sub">
                {fmtMoney(res.product.pricePaise)} · {t('stockLabel')} {qtyLabel(res.product.stock, res.product.unit)}
              </T>
              {res.added ? <T v="sub">✓ {t('addedToSale')}</T> : null}
              {!saleId ? <Btn label={t('restock')} onPress={() => router.push(`/product/${res.product!.id}`)} /> : null}
            </>
          ) : (
            <>
              <T v="h3">{t('unknownBarcode')}</T>
              <T c="ash">{t('unknownBarcodeHint')}</T>
              <Btn label={t('registerProduct')} onPress={() => router.push(`/product/new?barcode=${encodeURIComponent(res.code)}`)} />
            </>
          )}
          <Row>
            <Btn kind="outline" label={t('scanNext')} onPress={again} style={{ flex: 1 }} />
            {saleId ? <Btn kind="outline" label={t('done')} onPress={() => router.back()} style={{ flex: 1 }} /> : null}
          </Row>
        </Card>
      ) : granted && !camError ? (
        <>
          <View style={{ height: 320, borderRadius: R.card, overflow: 'hidden', backgroundColor: C.obsidian }}>
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39'] }}
              onBarcodeScanned={({ data }) => handle(data)}
              onMountError={() => setCamError(true)}
            />
          </View>
          <T c="ash">{t('scanGuide')}</T>
          {Platform.OS !== 'web' ? (
            <Btn kind="wash" label={torch ? t('torchOff') : t('torchOn')} onPress={() => setTorch((v) => !v)} />
          ) : null}
        </>
      ) : (
        <Card wash>
          {camError ? (
            <T v="sub">{t('cameraFailed')}</T>
          ) : !perm ? (
            <T v="sub">{t('loading')}</T>
          ) : perm.canAskAgain ? (
            <>
              <T v="sub">{t('cameraNeeded')}</T>
              <T c="ash">{t('cameraWhy')}</T>
              <Btn label={t('allowCamera')} onPress={ask} />
            </>
          ) : (
            <>
              <T v="sub">{t('cameraBlocked')}</T>
              {Platform.OS !== 'web' ? <Btn kind="outline" label={t('openSettings')} onPress={() => Linking.openSettings()} /> : null}
            </>
          )}
        </Card>
      )}

      {!res ? (
        <Card>
          <Field
            label={t('enterBarcode')}
            value={manual}
            onChangeText={setManual}
            keyboardType="number-pad"
            autoCapitalize="none"
            onSubmitEditing={() => handle(manual)}
          />
          <Btn kind="outline" label={t('lookup')} onPress={() => handle(manual)} disabled={!manual.trim()} />
        </Card>
      ) : null}
    </Screen>
  );
}
