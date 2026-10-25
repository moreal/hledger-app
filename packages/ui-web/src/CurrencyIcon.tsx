import {
  currencyIconSizes,
  getCurrencyIcon,
  type CurrencyIconSize,
} from '../../design-tokens/src/currency-icons';
import { tokens } from '../../design-tokens/src';

export interface CurrencyIconProps {
  commodity: string;
  size?: CurrencyIconSize | number;
  /** Omit beside visible text; provide when this icon conveys identity alone. */
  label?: string;
  className?: string;
}

export function CurrencyIcon({ commodity, size = 28, label, className }: CurrencyIconProps) {
  const icon = getCurrencyIcon(commodity);
  const dimension =
    typeof size === 'number' && Number.isFinite(size)
      ? Math.max(16, size)
      : currencyIconSizes[typeof size === 'string' ? size : 'medium'];
  return (
    <span
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-currency-kind={icon.kind}
      title={icon.code}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
        width: dimension,
        height: dimension,
        borderRadius: dimension * 0.31,
        background: icon.background,
        color: icon.foreground,
        fontFamily: tokens.fontFamily.web,
        verticalAlign: 'middle',
        overflow: 'hidden',
        lineHeight: 1,
      }}
    >
      <span
        aria-hidden="true"
        style={{ fontSize: dimension * 0.39, fontWeight: 600, lineHeight: 1.1 }}
      >
        {icon.glyph}
      </span>
      <span
        aria-hidden="true"
        style={{
          fontSize: dimension * 0.215,
          fontWeight: 600,
          lineHeight: 1.15,
          maxWidth: '90%',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          letterSpacing: '.02em',
        }}
      >
        {icon.code || '·'}
      </span>
    </span>
  );
}
