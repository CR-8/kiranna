import { useRouter } from 'expo-router';
import { useNetworkState } from 'expo-network';
import { useState, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { C, FONT, MAX_WIDTH, R } from '@/constants/theme';
import { useT } from '@/lib/i18n';

// ---------- text: one family, one weight; hierarchy by size and tracking ----------
const TYPE = {
  caption: { fontSize: 12, lineHeight: 16, letterSpacing: 0.7, textTransform: 'uppercase' },
  body: { fontSize: 16, lineHeight: 24 },
  sub: { fontSize: 20, lineHeight: 26 },
  h3: { fontSize: 24, lineHeight: 28 },
  h2: { fontSize: 28, lineHeight: 32 },
  h1: { fontSize: 40, lineHeight: 42 },
  btn: { fontSize: 16, lineHeight: 20, letterSpacing: 0.4 },
} satisfies Record<string, TextStyle>;

type Tone = 'ink' | 'ash' | 'paper';

export function T({ v = 'body', c = 'ink', style, ...p }: TextProps & { v?: keyof typeof TYPE; c?: Tone }) {
  return <Text {...p} style={[{ fontFamily: FONT, color: C[c] }, TYPE[v], style]} />;
}

// ---------- layout ----------
export const Row = ({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) => (
  <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 12 }, style]}>{children}</View>
);

export function Card({ children, wash, style }: { children: ReactNode; wash?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        wash
          ? { backgroundColor: C.bone, borderRadius: R.wash, borderWidth: 1, borderColor: C.hairline }
          : { backgroundColor: C.paper, borderRadius: R.card, borderWidth: 1, borderColor: C.hairline },
        { padding: 20, gap: 12 },
        style,
      ]}>
      {children}
    </View>
  );
}

export function Tag({ label, kind = 'plain' }: { label: string; kind?: 'plain' | 'alert' | 'active' }) {
  const bg = kind === 'alert' ? C.ink : kind === 'active' ? C.accent : C.paper;
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: R.tag,
        borderWidth: 1,
        borderColor: kind === 'alert' ? C.ink : C.smoke,
        backgroundColor: bg,
      }}>
      <T v="caption" c={kind === 'alert' ? 'paper' : 'ink'}>
        {label}
      </T>
    </View>
  );
}

export function NetTag() {
  const t = useT();
  const net = useNetworkState();
  const offline = net.isConnected === false || net.isInternetReachable === false;
  return <Tag label={offline ? t('offline') : t('online')} kind={offline ? 'alert' : 'plain'} />;
}

export function useOffline() {
  const net = useNetworkState();
  return net.isConnected === false || net.isInternetReachable === false;
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <Card wash>
      <T v="sub">{title}</T>
      {hint ? <T c="ash">{hint}</T> : null}
    </Card>
  );
}

// ---------- controls ----------
type BtnKind = 'primary' | 'outline' | 'wash';

export function Btn({
  label,
  onPress,
  kind = 'primary',
  disabled,
  style,
}: {
  label: string;
  onPress?: () => void;
  kind?: BtnKind;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = kind === 'primary' ? C.accent : kind === 'wash' ? C.bone : 'transparent';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        {
          minHeight: 56,
          paddingHorizontal: 20,
          paddingVertical: 12,
          borderRadius: R.button,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: kind === 'outline' ? C.ink : kind === 'wash' ? C.hairline : C.accent,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        },
        style,
      ]}>
      <T v="btn" style={{ textAlign: 'center' }}>
        {label}
      </T>
    </Pressable>
  );
}

export function Field({
  label,
  error,
  hint,
  style,
  ...p
}: TextInputProps & { label?: string; error?: string; hint?: string }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      {label ? <T v="caption" c="ash">{label}</T> : null}
      <TextInput
        {...p}
        placeholderTextColor={C.ash}
        onFocus={(e) => {
          setFocus(true);
          p.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          p.onBlur?.(e);
        }}
        style={[
          {
            minHeight: 56,
            paddingHorizontal: 16,
            paddingVertical: 12,
            fontSize: 18,
            fontFamily: FONT,
            color: C.ink,
            backgroundColor: C.paper,
            borderRadius: R.input,
            borderWidth: 1,
            borderColor: error ? C.ink : focus ? C.ink : C.smoke,
            outlineStyle: 'solid',
            outlineWidth: 0,
          } as TextStyle,
          style,
        ]}
      />
      {error ? <T c="ink">⚠ {error}</T> : hint ? <T v="caption" c="ash">{hint}</T> : null}
    </View>
  );
}

export function Choice<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: V;
  options: [V, string][];
  onChange: (v: V) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <T v="caption" c="ash">{label}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map(([v, text]) => {
          const on = v === value;
          return (
            <Pressable
              key={v}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => onChange(v)}
              style={{
                minHeight: 56,
                minWidth: 96,
                paddingHorizontal: 16,
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: R.button,
                borderWidth: 1,
                borderColor: on ? C.ink : C.smoke,
                backgroundColor: on ? C.accent : C.paper,
              }}>
              <T v="btn">{on ? `✓ ${text}` : text}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function SquareBtn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label === '−' ? 'minus' : 'plus'}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => ({
        width: 56,
        height: 56,
        borderRadius: R.wash,
        backgroundColor: C.bone,
        borderWidth: 1,
        borderColor: C.hairline,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}>
      <T v="h2">{label}</T>
    </Pressable>
  );
}

/** Standard microphone glyph, drawn with views (no icon font on web/Android). */
export function MicIcon({ size = 28, color = C.ink }: { size?: number; color?: string }) {
  const w = size * 0.36;
  return (
    <View style={{ width: size, height: size, alignItems: 'center' }}>
      <View style={{ width: w, height: size * 0.55, borderRadius: w / 2, backgroundColor: color }} />
      <View
        style={{
          position: 'absolute',
          top: size * 0.3,
          width: size * 0.62,
          height: size * 0.36,
          borderWidth: 2,
          borderTopWidth: 0,
          borderColor: color,
          borderBottomLeftRadius: size,
          borderBottomRightRadius: size,
        }}
      />
      <View style={{ position: 'absolute', top: size * 0.66, width: 2, height: size * 0.18, backgroundColor: color }} />
      <View style={{ position: 'absolute', top: size * 0.84, width: size * 0.34, height: 2, backgroundColor: color }} />
    </View>
  );
}

// ---------- screen shell ----------
export function Screen({
  title,
  back = true,
  footer,
  children,
}: {
  title: string;
  back?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const t = useT();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.bone }}>
      <View style={{ backgroundColor: C.paper, borderBottomWidth: 1, borderColor: C.hairline, paddingTop: insets.top }}>
        <View style={s.bar}>
          {back ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              style={s.back}>
              <T v="btn">← {t('back')}</T>
            </Pressable>
          ) : null}
          <T v="sub" style={{ flex: 1 }} numberOfLines={1}>
            {title}
          </T>
          <NetTag />
        </View>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: 32, alignItems: 'center' }}>
        <View style={{ width: '100%', maxWidth: MAX_WIDTH, gap: 16 }}>{children}</View>
      </ScrollView>
      {footer ? (
        <View
          style={{
            backgroundColor: C.paper,
            borderTopWidth: 1,
            borderColor: C.hairline,
            padding: 16,
            paddingBottom: 16 + insets.bottom,
            alignItems: 'center',
          }}>
          <View style={{ width: '100%', maxWidth: MAX_WIDTH, gap: 12 }}>{footer}</View>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 64 },
  back: { minHeight: 48, justifyContent: 'center', paddingRight: 8 },
});
