import { useRouter } from 'expo-router';
import { useNetworkState } from 'expo-network';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
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
import { parseQtyIn, pendingEvents, stepFor, fmtQty, type Lang, type Unit } from '@/lib/engine';
import { useT } from '@/lib/i18n';
import { actions, useApp, useNotice } from '@/lib/store';

// ---------- text: one family, one weight; hierarchy by size and tracking ----------
const TYPE = {
  caption: { fontSize: 12, lineHeight: 16, letterSpacing: 0.7, textTransform: 'uppercase' },
  body: { fontSize: 16, lineHeight: 24 },
  sub: { fontSize: 18, lineHeight: 24 },
  h3: { fontSize: 22, lineHeight: 28 },
  h2: { fontSize: 28, lineHeight: 32 },
  h1: { fontSize: 36, lineHeight: 42 },
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
        { padding: 16, gap: 8 },
        style,
      ]}>
      {children}
    </View>
  );
}

export function Tag({ label, kind = 'plain' }: { label: string; kind?: 'plain' | 'alert' | 'active' | 'warn' }) {
  const bg = kind === 'alert' ? C.ink : kind === 'active' ? C.accent : kind === 'warn' ? C.bone : C.paper;
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: R.tag,
        borderWidth: kind === 'warn' ? 2 : 1,
        borderColor: kind === 'alert' || kind === 'warn' ? C.ink : C.smoke,
        backgroundColor: bg,
      }}>
      <T v="caption" c={kind === 'alert' ? 'paper' : 'ink'}>
        {label}
      </T>
    </View>
  );
}

export function useOffline() {
  const net = useNetworkState();
  return net.isConnected === false || net.isInternetReachable === false;
}

/** ONLINE / OFFLINE tag. Offline is dark-filled AND worded, never colour alone. */
export function OfflineStatus() {
  const t = useT();
  const offline = useOffline();
  return <Tag label={offline ? t('offline') : t('online')} kind={offline ? 'alert' : 'plain'} />;
}

/** Local-save vs sync honesty: says what is waiting, never claims a sync happened. */
export function SyncStatus() {
  const t = useT();
  const pending = pendingEvents(useApp());
  return (
    <View>
      <T v="sub">{pending ? t('syncPending', { n: pending }) : t('syncAllDone')}</T>
      {pending ? <T c="ash">{t('syncWaiting')}</T> : null}
    </View>
  );
}

/** A labelled number. Pass onPress to make it open the bills/products behind it. */
export function Stat({ label, value, note, onPress }: { label: string; value: string; note?: string; onPress?: () => void }) {
  const body = (
    <View style={{ gap: 2 }}>
      <T v="caption" c="ash">{label}</T>
      <T v="h3">{value}</T>
      {note ? <T c="ash" style={{ fontSize: 13, lineHeight: 18 }}>{note}</T> : null}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label} ${value}`} onPress={onPress} style={({ pressed }) => ({ flexGrow: 1, flexBasis: 84, opacity: pressed ? 0.7 : 1 })}>
      {body}
    </Pressable>
  ) : (
    <View style={{ flexGrow: 1, flexBasis: 84 }}>{body}</View>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <Card wash>
      <T v="sub">{title}</T>
      {hint ? <T c="ash">{hint}</T> : null}
    </Card>
  );
}

export const ErrorMessage = ({ text }: { text: string }) => (
  <T accessibilityRole="alert" accessibilityLiveRegion="assertive">⚠ {text}</T>
);

// ---------- controls ----------
type BtnKind = 'primary' | 'outline' | 'wash';

export function Btn({
  label,
  a11y,
  onPress,
  kind = 'primary',
  size = 'md',
  disabled,
  style,
}: {
  label: string;
  a11y?: string;
  onPress?: () => void;
  kind?: BtnKind;
  size?: 'md' | 'sm';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = kind === 'primary' ? C.accent : kind === 'wash' ? C.bone : C.paper;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ?? label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        {
          minHeight: size === 'sm' ? 48 : 56,
          paddingHorizontal: size === 'sm' ? 8 : 20,
          paddingVertical: 8,
          borderRadius: R.button,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: kind === 'wash' ? C.hairline : C.ink,
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
    <View style={{ gap: 4 }}>
      {label ? <T v="caption" c="ash">{label}</T> : null}
      <TextInput
        {...p}
        accessibilityLabel={p.accessibilityLabel ?? label}
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
            minHeight: 52,
            paddingHorizontal: 16,
            paddingVertical: 10,
            fontSize: 18,
            fontFamily: FONT,
            color: C.ink,
            backgroundColor: C.paper,
            borderRadius: R.input,
            borderWidth: focus || error ? 2 : 1,
            borderColor: error || focus ? C.ink : C.smoke,
            outlineStyle: 'solid',
            outlineWidth: 0,
          } as TextStyle,
          style,
        ]}
      />
      {error ? <ErrorMessage text={error} /> : hint ? <T v="caption" c="ash">{hint}</T> : null}
    </View>
  );
}

export function Choice<V extends string>({
  label,
  value,
  options,
  onChange,
  row,
}: {
  label?: string;
  value: V;
  options: [V, string][];
  onChange: (v: V) => void;
  /** Keep every option on one line (long labels wrap inside their own button) instead of wrapping onto new rows. */
  row?: boolean;
}) {
  return (
    <View style={{ gap: 4 }}>
      {label ? <T v="caption" c="ash">{label}</T> : null}
      <View style={{ flexDirection: 'row', flexWrap: row ? 'nowrap' : 'wrap', gap: 8 }}>
        {options.map(([v, text]) => {
          const on = v === value;
          return (
            <Pressable
              key={v}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => onChange(v)}
              style={{
                flexGrow: 1,
                flexBasis: row ? 0 : undefined,
                minHeight: 48,
                minWidth: row ? 0 : 72,
                paddingHorizontal: 12,
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: R.button,
                borderWidth: on ? 2 : 1,
                borderColor: on ? C.ink : C.smoke,
                backgroundColor: on ? C.accent : C.paper,
              }}>
              <T v="btn" style={{ textAlign: 'center' }}>{on ? `✓ ${text}` : text}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function LanguageSelector({ label }: { label?: string }) {
  const { lang } = useApp();
  return (
    <Choice<Lang>
      row
      label={label}
      value={lang}
      onChange={(l) => actions.setSettings({ lang: l })}
      options={[
        ['en', 'ENGLISH'],
        ['hi', 'हिन्दी'],
      ]}
    />
  );
}

/** Inline two-way question. No modal: the answer stays next to what it is about. */
export function ConfirmAction({
  ask,
  yes,
  no,
  onYes,
  onNo,
}: {
  ask: string;
  yes: string;
  no: string;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <Card wash>
      <T v="sub">{ask}</T>
      <Row>
        <Btn kind="outline" label={yes} onPress={onYes} style={{ flex: 1 }} />
        <Btn kind="wash" label={no} onPress={onNo} style={{ flex: 1 }} />
      </Row>
    </Card>
  );
}

// ---------- quantity ----------
/** Commits on blur/submit. Accepts "2", "0.5", or "500g" on a kg item; remount via `key` when the stored value changes. */
function QtyInput({ value, unit, onCommit }: { value: number; unit: Unit; onCommit: (q: number) => void }) {
  const t = useT();
  const [text, setText] = useState(fmtQty(value));
  const commit = () => {
    const q = parseQtyIn(text, unit);
    if (q) onCommit(q);
    else setText(fmtQty(value));
  };
  return (
    <TextInput
      value={text}
      onChangeText={setText}
      onBlur={commit}
      onSubmitEditing={commit}
      // measured units take "500g" / "1.5kg", which a numeric pad cannot type
      keyboardType={['g', 'kg', 'ml', 'L'].includes(unit) ? 'default' : 'decimal-pad'}
      selectTextOnFocus
      accessibilityLabel={t('qtyToAdd')}
      style={{
        width: 54,
        minHeight: 50,
        textAlign: 'center',
        fontSize: 22,
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

const StepBtn = ({ label, a11y, onPress, disabled }: { label: string; a11y: string; onPress: () => void; disabled?: boolean }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={a11y}
    accessibilityState={{ disabled: !!disabled }}
    onPress={disabled ? undefined : onPress}
    style={({ pressed }) => ({
      width: 50,
      height: 50,
      borderRadius: R.wash,
      backgroundColor: C.bone,
      borderWidth: 1,
      borderColor: C.ink,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
    })}>
    <T v="h2">{label}</T>
  </Pressable>
);

export function QuantityStepper({ qty, unit, onChange }: { qty: number; unit: Unit; onChange: (q: number) => void }) {
  const t = useT();
  const step = stepFor(unit);
  return (
    <Row style={{ gap: 6 }}>
      <StepBtn label="−" a11y={t('decrease')} disabled={qty <= step} onPress={() => onChange(qty - step)} />
      <QtyInput key={qty} value={qty} unit={unit} onCommit={onChange} />
      <StepBtn label="+" a11y={t('increase')} onPress={() => onChange(qty + step)} />
    </Row>
  );
}

// ---------- voice ----------
export type MicState = 'ready' | 'listening' | 'processing' | 'results' | 'unavailable';
const MIC_KEY = {
  ready: 'micReady',
  listening: 'micListening',
  processing: 'micProcessing',
  results: 'micResults',
  unavailable: 'micUnavailable',
} as const;

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

export function MicrophoneButton({ state, onPress }: { state: MicState; onPress: () => void }) {
  const t = useT();
  const live = state === 'listening';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('startSpeaking')}. ${t(MIC_KEY[state])}`}
      accessibilityState={{ busy: state === 'processing' }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 68,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        paddingHorizontal: 20,
        borderRadius: R.card,
        borderWidth: live ? 3 : 1,
        borderColor: C.ink,
        backgroundColor: live ? C.accent : C.paper,
        opacity: pressed ? 0.75 : 1,
      })}>
      <MicIcon size={32} />
      <View style={{ flex: 1 }}>
        <T v="h3">{t('startSpeaking')}</T>
        <T v="caption" c="ash">{t(MIC_KEY[state])}</T>
      </View>
    </Pressable>
  );
}

// ---------- screen shell ----------
/** NEW BILL is a tab too, but it starts a sale instead of showing a list — so it is never the active one. `home` highlights nothing. */
export type Tab = 'home' | 'stock' | 'history' | 'reports' | 'more';

function TabBar({ active }: { active: Tab }) {
  const router = useRouter();
  const t = useT();
  const insets = useSafeAreaInsets();
  const tabs: [Tab | 'bill', string, () => void][] = [
    ['bill', t('newBill'), () => router.replace(`/sale/${actions.startSale()}`)],
    ['stock', t('tabStock'), () => router.replace('/inventory')],
    ['history', t('tabHistory'), () => router.replace('/bills')],
    ['reports', t('tabReports'), () => router.replace('/reports')],
    ['more', t('more'), () => router.replace('/more')],
  ];
  return (
    <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: C.hairline, backgroundColor: C.paper, paddingBottom: insets.bottom }}>
      {tabs.map(([k, label, go]) => {
        const on = k === active;
        return (
          <Pressable
            key={k}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: on }}
            onPress={on ? undefined : go}
            style={{
              flex: 1,
              minHeight: 60,
              paddingHorizontal: 4,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? C.accent : C.paper,
              borderTopWidth: on ? 3 : 0,
              borderColor: C.ink,
            }}>
            <T v="btn" style={{ textAlign: 'center', fontSize: 13, letterSpacing: 0 }} numberOfLines={2}>
              {label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  return open;
}

/**
 * Header + flexible body + stable footer (+ bottom tabs on the four main screens).
 * `scroll={false}` hands the body to the screen so a single FlatList can own the scrolling — no nested scrollers.
 */
export function Screen({
  title,
  back = true,
  tab,
  footer,
  scroll = true,
  children,
}: {
  title: string;
  back?: boolean;
  tab?: Tab;
  footer?: ReactNode;
  scroll?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const t = useT();
  const insets = useSafeAreaInsets();
  const notice = useNotice();
  const kbOpen = useKeyboardOpen();
  const showTabs = !!tab && !kbOpen;
  return (
    <View style={{ flex: 1, backgroundColor: C.paper }}>
      <View style={{ backgroundColor: C.paper, borderBottomWidth: 1, borderColor: C.hairline, paddingTop: insets.top }}>
        <View style={s.bar}>
          {back && tab !== 'home' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tab ? t('home') : t('back')}
              onPress={() => (tab ? router.replace('/') : router.canGoBack() ? router.back() : router.replace('/'))}
              style={s.back}>
              <T v="btn">← {tab ? t('home') : t('back')}</T>
            </Pressable>
          ) : null}
          <T v="sub" style={{ flex: 1 }} numberOfLines={2}>
            {title}
          </T>
          <OfflineStatus />
        </View>
      </View>
      {notice ? (
        <View accessibilityLiveRegion="polite" style={s.notice}>
          <T v="btn" style={{ textAlign: 'center' }}>✓ {notice}</T>
        </View>
      ) : null}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, paddingBottom: 24, alignItems: 'center' }}>
            <View style={{ width: '100%', maxWidth: MAX_WIDTH, gap: 12 }}>{children}</View>
          </ScrollView>
        ) : (
          <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 12, alignItems: 'center' }}>
            <View style={{ flex: 1, width: '100%', maxWidth: MAX_WIDTH, gap: 12 }}>{children}</View>
          </View>
        )}
        {footer ? (
          <View
            style={{
              backgroundColor: C.paper,
              borderTopWidth: 1,
              borderColor: C.hairline,
              padding: 12,
              paddingBottom: 12 + (showTabs || kbOpen ? 0 : insets.bottom),
              alignItems: 'center',
            }}>
            <View style={{ width: '100%', maxWidth: MAX_WIDTH, gap: 8 }}>{footer}</View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
      {showTabs ? <TabBar active={tab} /> : null}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 56 },
  back: { minHeight: 48, justifyContent: 'center', paddingRight: 8 },
  notice: { backgroundColor: C.accent, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: C.ink },
});
