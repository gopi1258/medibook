# MediBook — Brand Spec (extracted from supplied screenshot)

Source: brand-kit screenshot supplied by the client. The supplied kit shows a pink/magenta
health-tech identity ("flower/pinwheel" logo mark, Poppins + Inter). Use these values as the
single source of truth for the app design tokens.

## Logo
- Mark: a 4–5 petal "pinwheel / blossom" built from overlapping rounded petals rotated around a
  common centre. Petals are filled with a pink→magenta gradient.
- Do NOT copy any wordmark text from the kit. The product name for this build is **MediBook**
  (PRD §1.1 working title). Render the wordmark in Poppins SemiBold next to the mark.

## Colour tokens
| Token | Hex | Use |
|---|---|---|
| primary | #EC4899 | primary brand pink (buttons, active states) |
| primaryStrong | #E11D6E | pressed / emphasis rose |
| coral | #FB7185 | gradient start, soft accents |
| accent | #A855F7 | secondary accent (charts, badges) |
| gradientStart | #FB7185 | brand gradient start |
| gradientEnd | #E11D6E | brand gradient end |
| bg | #FDF2F4 | app background (blush) |
| surface | #FFFFFF | cards |
| surfaceAlt | #FFDCCF | peach secondary surface (imagery backdrops, highlight cards) |
| mint | #DFF5E4 | success/positive surface |
| dark | #1A1A2E | primary text / dark surfaces |
| darkSurface | #141414 | dark cards |
| textSecondary | #6B7280 | secondary text |
| textMuted | #9CA3AF | captions |
| border | #EFEFF1 | dividers, input fills |
| success | #34C759 | verified badge, positive |
| danger | #EF4444 | destructive / emergency |
| star | #FFC529 | ratings |
| info | #AEC4F7 | informational accents |

## Typography
- Headings: Poppins (SemiBold/Bold)
- Body/UI: Inter (Regular/Medium/SemiBold)
- Scale (px): display 28 / h1 24 / h2 20 / h3 17 / body 15 / small 13 / caption 11
- Weights: 400, 500, 600, 700

## Shape & spacing
- Radii: xs 8, sm 12, md 16, lg 20, xl 24, pill 999
- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40
- Shadows: soft, low-opacity pink-tinted
- Touch targets >= 44pt; support dynamic type + screen reader labels (WCAG 2.2 AA target).

## Reference layout patterns (from supplied mobile UI kit — structure only, not colour)
- Light app background, white large-radius cards with soft shadows.
- Stacked screen header: back chevron (left) + centred title + right action icon.
- Floating/recessed bottom tab bar with 5 tabs, active tab emphasised.
- Pill buttons; segmented pill switcher for Upcoming/Past; filter chips (selected = filled).
- Doctor rows: rounded-rect photo on a peach backdrop, name, specialty, star rating, favourite heart.
- Booking is a linear flow: Profile -> Slot picker -> Booking sheet -> Payment -> Confirmation.
