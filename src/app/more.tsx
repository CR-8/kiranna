import { useRouter, type Href } from 'expo-router';
import { Pressable } from 'react-native';

import { Screen, SyncStatus, T } from '@/components/ui';
import { C, R } from '@/constants/theme';
import { useT } from '@/lib/i18n';

export default function More() {
  const t = useT();
  const router = useRouter();
  const items: [string, string, Href][] = [
    [t('productsTitle'), t('productsHint'), '/products'],
    [t('purchases'), t('purchasesHint'), '/purchases'],
    [t('paymentSummary'), t('paymentsHint'), '/payments'],
    [t('syncDevices'), t('syncHint'), '/sync'],
    [t('settings'), t('settingsHint'), '/settings'],
  ];
  return (
    <Screen title={t('more')} tab="more">
      {items.map(([title, hint, href]) => (
        <Pressable
          key={title}
          accessibilityRole="button"
          accessibilityLabel={title}
          onPress={() => router.push(href)}
          style={({ pressed }) => ({
            minHeight: 68,
            paddingHorizontal: 16,
            paddingVertical: 10,
            justifyContent: 'center',
            gap: 2,
            borderRadius: R.card,
            borderWidth: 1,
            borderColor: C.smoke,
            opacity: pressed ? 0.75 : 1,
          })}>
          <T v="sub">{title}</T>
          <T c="ash">{hint}</T>
        </Pressable>
      ))}
      <SyncStatus />
    </Screen>
  );
}
