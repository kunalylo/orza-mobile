import { useState, type Ref } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { haptics } from '@/lib/haptics';
import { colors, fonts, radii } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

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
export function TextField({ label, error, hint, icon, secure, suffix, containerStyle, inputStyle, onFocus, onBlur, editable = true, ref, ...rest }: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);
  const invalid = !!error;

  return (
    <View style={containerStyle}>
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
        <TextInput
          ref={ref}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          accessibilityHint={error ?? hint}
          accessibilityState={{ disabled: !editable }}
          placeholderTextColor="rgba(20,20,20,0.38)"
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
  suffix: { paddingRight: 16, textTransform: 'uppercase' },
  toggle: { paddingHorizontal: 16, height: 52, justifyContent: 'center' },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 7, marginLeft: 4 },
  messageText: { flex: 1 },
  hint: { marginTop: 7, marginLeft: 4 },
});
