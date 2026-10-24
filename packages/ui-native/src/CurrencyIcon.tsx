import { Text, View } from 'react-native';
import { currencyIconSizes, getCurrencyIcon, type CurrencyIconSize } from '../../design-tokens/src/currency-icons';

export interface CurrencyIconProps { commodity: string; size?: CurrencyIconSize | number; label?: string }
export function CurrencyIcon({ commodity, size = 'medium', label }: CurrencyIconProps) {
  const icon = getCurrencyIcon(commodity);
  const dimension = typeof size === 'number' && Number.isFinite(size) ? Math.max(16, size) : currencyIconSizes[typeof size === 'string' ? size : 'medium'];
  return <View accessible={Boolean(label)} accessibilityRole={label ? 'image' : undefined} accessibilityLabel={label}
    importantForAccessibility={label ? 'yes' : 'no-hide-descendants'}
    style={{ width: dimension, height: dimension, borderRadius: dimension * .31, backgroundColor: icon.background, alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
    <Text accessible={false} allowFontScaling={false} style={{ color: icon.foreground, fontSize: dimension * .39, lineHeight: dimension * .43, fontWeight: '600', textAlign: 'center' }}>{icon.glyph}</Text>
    <Text accessible={false} allowFontScaling={false} numberOfLines={1} style={{ color: icon.foreground, fontSize: dimension * .215, lineHeight: dimension * .25, maxWidth: '90%', fontWeight: '600', letterSpacing: .2, textAlign: 'center' }}>{icon.code || '·'}</Text>
  </View>;
}
