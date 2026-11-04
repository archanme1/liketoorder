import { TextField } from '@/components/ui';

type PriceFieldProps = {
  value: string;
  onChangeText: (text: string) => void;
  onBlur?: () => void;
  /** The currency code shown in the label, or null when none is chosen yet. */
  currencyCode: string | null;
  /** The currency's decimals, or null when none is chosen yet. */
  minorUnits: number | null;
  error?: string;
};

function hintFor(minorUnits: number | null): string {
  if (minorUnits === null) return 'Optional. You’ll choose a currency when you add a price.';
  if (minorUnits === 0) return 'Optional. Whole numbers only, e.g. 1200.';
  const example = minorUnits === 3 ? '1.250' : '12.50';
  return `Optional. Up to ${minorUnits} decimals, e.g. ${example}.`;
}

/** Price as text; parsed per currency on save (no float maths). */
export function PriceField({
  value,
  onChangeText,
  onBlur,
  currencyCode,
  minorUnits,
  error,
}: PriceFieldProps) {
  return (
    <TextField
      label={currencyCode ? `Price (${currencyCode})` : 'Price'}
      value={value}
      onChangeText={onChangeText}
      onBlur={onBlur}
      error={error}
      hint={hintFor(minorUnits)}
      keyboardType={minorUnits === 0 ? 'number-pad' : 'decimal-pad'}
      inputMode={minorUnits === 0 ? 'numeric' : 'decimal'}
      autoCorrect={false}
      maxLength={14}
    />
  );
}
