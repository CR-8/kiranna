import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { Btn, LanguageSelector, Screen, SyncStatus, T, useOffline } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { openDrafts } from '@/lib/engine';
import { useT } from '@/lib/i18n';
import { actions, useApp } from '@/lib/store';

function Tile({ title, hint, onPress, primary }: { title: string; hint: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: '45%',
        minHeight: 120,
        padding: 16,
        justifyContent: 'flex-end',
        gap: 4,
        borderRadius: R.card,
        borderWidth: primary ? 2 : 1,
        borderColor: primary ? C.ink : C.smoke,
        backgroundColor: primary ? C.accent : C.paper,
        opacity: pressed ? 0.8 : 1,
      })}>
      <T v="h3">{title}</T>
      <T c={primary ? 'ink' : 'ash'}>{hint}</T>
    </Pressable>
  );
}

/** Four obvious actions and one status line. Nothing else. */
export default function Home() {
  const t = useT();
  const router = useRouter();
  const app = useApp();
  const offline = useOffline();
  const waiting = openDrafts(app).filter((d) => d.items.length).length;

  return (
    <Screen title={t('appName')} back={false} scroll={false}>
      <T v="h2" numberOfLines={1}>{app.shopName}</T>
      {offline ? <T v="sub">{t('offlineBanner')}</T> : <SyncStatus />}
      {waiting ? <Btn kind="outline" label={`${t('openSalesBtn')} (${waiting})`} onPress={() => router.push('/sales')} /> : null}

      <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignContent: 'stretch' }}>
        <Tile primary title={t('newBill')} hint={t('newBillHint')} onPress={() => router.push(`/sale/${actions.startSale()}`)} />
        <Tile title={t('stock')} hint={t('stockHint')} onPress={() => router.push('/inventory')} />
        <Tile title={t('history')} hint={t('historyHint')} onPress={() => router.push('/bills')} />
        <Tile title={t('more')} hint={t('moreHint')} onPress={() => router.push('/more')} />
      </View>
      <LanguageSelector />
    </Screen>
  );
}
