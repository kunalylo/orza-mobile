import { useEffect, useRef, useState, type Ref } from 'react';
import { Platform, Pressable, Text as RNText, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { haptics } from '@/lib/haptics';
import { colors, fonts, radii } from '@/theme';

import { Icon, type IconName } from './Icon';
import { useScrollReveal } from './scrollReveal';
import { Text } from './Text';

const PLACEHOLDER = 'rgba(20,20,20,0.38)';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  /** Shown under the field in red; also announced to screen readers. */
  error?: string | null;
  hint?: string;
  icon?: IconName;
  /** Password field with a show / hide toggle. */
  secure?: boolean;
  /** Text after the value, e.g. "kg". */
  suffix?: string;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: TextInputProps['style'];
  ref?: Ref<TextInput>;
}

/** Labelled glass input with cyan focus ring, inline error, optional icon / suffix / password toggle. */
export function TextField({ label, error, hint, icon, secure, suffix, containerStyle, inputStyle, onFocus, onBlur, editable = true, placeholder, ref, ...rest }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  // Android draws a single-line field's placeholder (the EditText hint) with line wrapping: one longer than the field
  // wraps onto a second line that the one-line field cuts in half ("Add another, e.g. mush…" with the rest sliced off),
  // on narrow phones and at large font sizes. Single-line controlled fields draw their own one-line placeholder that
  // ends in "…" instead (multiline fields and custom input styles keep the native one).
  const ownPlaceholder = Platform.OS === 'android' && !!placeholder && !rest.multiline && !inputStyle && rest.value !== undefined;
  const [hidden, setHidden] = useState(true);
  const invalid = !!error;
  const wrap = useRef<View>(null);
  const reveal = useScrollReveal();

  // On a form screen, keep the whole field (with its error line) in view while it is focused — also when an error
  // appears under the already-focused field (see scrollReveal.ts).
  useEffect(() => {
    if (!reveal) return;
    if (focused) reveal.focus(wrap.current);
    else reveal.blur(wrap.current);
  }, [reveal, focused, error, hint]);

  const input = (
    <TextInput
      ref={ref}
      accessibilityLabel={rest.accessibilityLabel ?? label}
      accessibilityHint={error ?? hint ?? (ownPlaceholder && !rest.value ? placeholder : undefined)}
      placeholder={ownPlaceholder ? undefined : placeholder}
      accessibilityState={{ disabled: !editable }}
      placeholderTextColor={PLACEHOLDER}
      selectionColor={colors.cyan600}
      cursorColor={colors.cyan600}
      editable={editable}
      secureTextEntry={secure ? hidden : rest.secureTextEntry}
      maxFontSizeMultiplier={1.4}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[styles.input, icon ? styles.withIcon : null, inputStyle]}
      {...rest}
    />
  );

  return (
    <View ref={wrap} collapsable={false} style={containerStyle}>
      {label ? (
        <Text variant="label" tone="text" style={styles.label} nativeID={rest.nativeID ? `${rest.nativeID}-label` : undefined}>
          {label}
        </Text>
      ) : null}
      <View style={[styles.field, focused && styles.focused, invalid && styles.invalid, !editable && styles.readonly]}>
        {icon ? (
          <View style={styles.icon}>
            <Icon name={icon} size={18} color={focused ? colors.cyan700 : colors.subtle} />
          </View>
        ) : null}
        {ownPlaceholder ? (
          <View style={styles.inputBox}>
            {input}
            {rest.value ? null : (
              <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[styles.placeholderWrap, icon ? styles.placeholderWithIcon : null]}>
                <RNText numberOfLines={1} ellipsizeMode="tail" maxFontSizeMultiplier={1.4} style={styles.placeholder}>
                  {placeholder}
                </RNText>
              </View>
            )}
          </View>
        ) : (
          input
        )}
        {suffix ? (
          <Text variant="mono" tone="subtle" style={styles.suffix}>
            {suffix}
          </Text>
        ) : null}
        {secure ? (
          <Pressable
            onPress={() => {
              haptics.select();
              setHidden((h) => !h);
            }}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            hitSlop={8}
            style={styles.toggle}
          >
            <Icon name={hidden ? 'eye' : 'eye-off'} size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <View style={styles.message} accessibilityLiveRegion="polite">
          <Icon name="alert-circle" size={13} color={colors.error} />
          <Text variant="caption" tone="error" style={styles.messageText}>
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text variant="caption" tone="subtle" style={styles.hint}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { marginBottom: 8, marginLeft: 4 },
  field: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.glassStrong,
  },
  focused: { borderColor: colors.cyan, backgroundColor: colors.white, boxShadow: '0px 0px 0px 4px rgba(11,190,220,0.14)' },
  invalid: { borderColor: colors.error, boxShadow: '0px 0px 0px 4px rgba(176,44,44,0.08)' },
  readonly: { opacity: 0.6 },
  icon: { paddingLeft: 16 },
  input: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  withIcon: { paddingLeft: 10 },
  /** Single-line field with its own placeholder: the input + the placeholder drawn over it, where its text starts. */
  inputBox: { flex: 1, alignSelf: 'stretch', justifyContent: 'center' },
  placeholderWrap: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, justifyContent: 'center', paddingHorizontal: 16 },
  placeholderWithIcon: { paddingLeft: 10 },
  placeholder: { fontFamily: fonts.body, fontSize: 16, color: PLACEHOLDER },
  suffix: { paddingRight: 16, textTransform: 'uppercase' },
  toggle: { paddingHorizontal: 16, height: 52, justifyContent: 'center' },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 7, marginLeft: 4 },
  messageText: { flex: 1 },
  hint: { marginTop: 7, marginLeft: 4 },
});
