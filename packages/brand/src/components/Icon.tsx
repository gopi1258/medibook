import * as React from 'react';
import Svg, { Circle, G, Line, Path, Polyline, Rect } from 'react-native-svg';

import { color } from '../tokens';

/**
 * Line-art icon set drawn with `react-native-svg`.
 *
 * Deliberately self-contained: no icon font, no remote assets, so the apps work
 * fully offline. All glyphs are authored on a 24×24 grid with round caps.
 */
export const iconNames = [
  'chevron-left',
  'chevron-right',
  'chevron-down',
  'chevron-up',
  'arrow-right',
  'arrow-left',
  'home',
  'search',
  'calendar',
  'calendar-plus',
  'calendar-check',
  'bell',
  'bell-off',
  'user',
  'user-plus',
  'users',
  'clock',
  'star',
  'star-filled',
  'heart',
  'heart-filled',
  'plus',
  'minus',
  'close',
  'check',
  'check-circle',
  'alert-circle',
  'alert-triangle',
  'info',
  'filter',
  'sliders',
  'video',
  'map-pin',
  'phone',
  'mail',
  'credit-card',
  'receipt',
  'share',
  'download',
  'settings',
  'help',
  'logout',
  'trash',
  'edit',
  'upload',
  'camera',
  'refresh',
  'lock',
  'shield-check',
  'globe',
  'building',
  'activity',
  'stethoscope',
  'baby',
  'brain',
  'eye',
  'bone',
  'tooth',
  'droplet',
  'sparkle',
  'briefcase',
  'sun',
  'link',
  'unlink',
  'more',
  'grid',
  'list',
  'external-link',
] as const;

export type IconName = (typeof iconNames)[number];

export type IconProps = {
  name: IconName;
  /** Rendered size in points. Defaults to 22. */
  size?: number;
  /** Stroke/fill colour. Defaults to `color.dark`. */
  color?: string;
  strokeWidth?: number;
  /** Decorative by default; pass a label to expose it to screen readers. */
  accessibilityLabel?: string;
};

const S = (props: { sw: number; c: string }): Record<string, unknown> => ({
  stroke: props.c,
  strokeWidth: props.sw,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  fill: 'none',
});

function shapes(name: IconName, sw: number, c: string): React.ReactNode {
  const s = S({ sw, c });
  switch (name) {
    case 'chevron-left':
      return <Polyline points="15 5 8.5 12 15 19" {...s} />;
    case 'chevron-right':
      return <Polyline points="9 5 15.5 12 9 19" {...s} />;
    case 'chevron-down':
      return <Polyline points="5 9 12 15.5 19 9" {...s} />;
    case 'chevron-up':
      return <Polyline points="5 15 12 8.5 19 15" {...s} />;
    case 'arrow-right':
      return (
        <G {...s}>
          <Line x1="4" y1="12" x2="19" y2="12" />
          <Polyline points="13 6 19 12 13 18" />
        </G>
      );
    case 'arrow-left':
      return (
        <G {...s}>
          <Line x1="20" y1="12" x2="5" y2="12" />
          <Polyline points="11 6 5 12 11 18" />
        </G>
      );
    case 'home':
      return (
        <G {...s}>
          <Path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" />
          <Path d="M9.5 20.5v-6h5v6" />
        </G>
      );
    case 'search':
      return (
        <G {...s}>
          <Circle cx="11" cy="11" r="6.25" />
          <Line x1="15.6" y1="15.6" x2="20.5" y2="20.5" />
        </G>
      );
    case 'calendar':
      return (
        <G {...s}>
          <Rect x="3.5" y="5" width="17" height="15" rx="3" />
          <Line x1="3.5" y1="10" x2="20.5" y2="10" />
          <Line x1="8" y1="3" x2="8" y2="6.5" />
          <Line x1="16" y1="3" x2="16" y2="6.5" />
        </G>
      );
    case 'calendar-plus':
      return (
        <G {...s}>
          <Rect x="3.5" y="5" width="17" height="15" rx="3" />
          <Line x1="3.5" y1="10" x2="20.5" y2="10" />
          <Line x1="12" y1="13" x2="12" y2="18" />
          <Line x1="9.5" y1="15.5" x2="14.5" y2="15.5" />
        </G>
      );
    case 'calendar-check':
      return (
        <G {...s}>
          <Rect x="3.5" y="5" width="17" height="15" rx="3" />
          <Line x1="3.5" y1="10" x2="20.5" y2="10" />
          <Polyline points="9 15 11.2 17.2 15.2 13.2" />
        </G>
      );
    case 'bell':
      return (
        <G {...s}>
          <Path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 3 .8 4.6 1.8 5.6.5.6.1 1.4-.7 1.4H5.4c-.8 0-1.2-.8-.7-1.4 1-1 1.8-2.6 1.8-5.6z" />
          <Path d="M10 20a2.2 2.2 0 0 0 4 0" />
        </G>
      );
    case 'bell-off':
      return (
        <G {...s}>
          <Path d="M6.5 10a5.5 5.5 0 0 1 9-4.1" />
          <Path d="M17.5 10.6c.1 2.4.8 3.6 1.8 4.6.5.6.1 1.4-.7 1.4H9" />
          <Path d="M10 20a2.2 2.2 0 0 0 4 0" />
          <Line x1="4" y1="3.5" x2="20.5" y2="20.5" />
        </G>
      );
    case 'user':
      return (
        <G {...s}>
          <Circle cx="12" cy="8.5" r="3.75" />
          <Path d="M4.8 20.2c0-3.5 3.2-5.7 7.2-5.7s7.2 2.2 7.2 5.7" />
        </G>
      );
    case 'user-plus':
      return (
        <G {...s}>
          <Circle cx="10" cy="8.5" r="3.6" />
          <Path d="M3.4 20.2c0-3.4 2.9-5.4 6.6-5.4 1.2 0 2.3.2 3.2.6" />
          <Line x1="17.5" y1="13" x2="17.5" y2="19" />
          <Line x1="14.5" y1="16" x2="20.5" y2="16" />
        </G>
      );
    case 'users':
      return (
        <G {...s}>
          <Circle cx="9.5" cy="8.6" r="3.4" />
          <Path d="M3.2 20c0-3.3 2.8-5.2 6.3-5.2s6.3 1.9 6.3 5.2" />
          <Path d="M16.4 5.6a3.4 3.4 0 0 1 0 6.4" />
          <Path d="M18 14.9c1.8.6 3 2 3 3.9" />
        </G>
      );
    case 'clock':
      return (
        <G {...s}>
          <Circle cx="12" cy="12" r="8.25" />
          <Polyline points="12 7.5 12 12.3 15.5 14.2" />
        </G>
      );
    case 'star':
      return (
        <Path
          d="M12 3.6l2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 16.98l-5.25 2.77 1-5.85L3.5 9.75l5.9-.85z"
          stroke={c}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      );
    case 'star-filled':
      return (
        <Path
          d="M12 3.6l2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 16.98l-5.25 2.77 1-5.85L3.5 9.75l5.9-.85z"
          fill={c}
        />
      );
    case 'heart':
      return (
        <Path
          d="M12 19.8C7 16.4 3.6 13.6 3.6 10.2A4.4 4.4 0 0 1 8 5.8c1.7 0 3.2.9 4 2.3a4.7 4.7 0 0 1 4-2.3 4.4 4.4 0 0 1 4.4 4.4c0 3.4-3.4 6.2-8.4 9.6z"
          {...s}
        />
      );
    case 'heart-filled':
      return (
        <Path
          d="M12 19.8C7 16.4 3.6 13.6 3.6 10.2A4.4 4.4 0 0 1 8 5.8c1.7 0 3.2.9 4 2.3a4.7 4.7 0 0 1 4-2.3 4.4 4.4 0 0 1 4.4 4.4c0 3.4-3.4 6.2-8.4 9.6z"
          fill={c}
        />
      );
    case 'plus':
      return (
        <G {...s}>
          <Line x1="12" y1="5" x2="12" y2="19" />
          <Line x1="5" y1="12" x2="19" y2="12" />
        </G>
      );
    case 'minus':
      return <Line x1="5" y1="12" x2="19" y2="12" {...s} />;
    case 'close':
      return (
        <G {...s}>
          <Line x1="6" y1="6" x2="18" y2="18" />
          <Line x1="18" y1="6" x2="6" y2="18" />
        </G>
      );
    case 'check':
      return <Polyline points="5 12.8 9.7 17.5 19 7.5" {...s} />;
    case 'check-circle':
      return (
        <G {...s}>
          <Circle cx="12" cy="12" r="8.25" />
          <Polyline points="8.2 12.2 11 15 15.8 9.6" />
        </G>
      );
    case 'alert-circle':
      return (
        <G {...s}>
          <Circle cx="12" cy="12" r="8.25" />
          <Line x1="12" y1="7.8" x2="12" y2="13" />
          <Circle cx="12" cy="16.2" r="0.9" fill={c} stroke="none" />
        </G>
      );
    case 'alert-triangle':
      return (
        <G {...s}>
          <Path d="M12 4.2 20.5 19H3.5z" />
          <Line x1="12" y1="9.6" x2="12" y2="14" />
          <Circle cx="12" cy="16.6" r="0.9" fill={c} stroke="none" />
        </G>
      );
    case 'info':
      return (
        <G {...s}>
          <Circle cx="12" cy="12" r="8.25" />
          <Line x1="12" y1="11" x2="12" y2="16" />
          <Circle cx="12" cy="7.9" r="0.9" fill={c} stroke="none" />
        </G>
      );
    case 'filter':
      return <Path d="M3.8 5.5h16.4l-6.3 7.3v5.6l-3.8 2v-7.6z" {...s} />;
    case 'sliders':
      return (
        <G {...s}>
          <Line x1="4" y1="7" x2="20" y2="7" />
          <Line x1="4" y1="12" x2="20" y2="12" />
          <Line x1="4" y1="17" x2="20" y2="17" />
          <Circle cx="9" cy="7" r="2" fill={color.surface} />
          <Circle cx="15" cy="12" r="2" fill={color.surface} />
          <Circle cx="8" cy="17" r="2" fill={color.surface} />
        </G>
      );
    case 'video':
      return (
        <G {...s}>
          <Rect x="3" y="6.5" width="12.5" height="11" rx="3" />
          <Path d="M15.5 11.2l4.1-2.5a.8.8 0 0 1 1.2.7v5.2a.8.8 0 0 1-1.2.7l-4.1-2.5z" />
        </G>
      );
    case 'map-pin':
      return (
        <G {...s}>
          <Path d="M12 21c4-4.4 6-7.6 6-10.4A6 6 0 0 0 6 10.6C6 13.4 8 16.6 12 21z" />
          <Circle cx="12" cy="10.4" r="2.3" />
        </G>
      );
    case 'phone':
      return (
        <Path
          d="M6.2 3.8h2.9l1.4 3.6-2 1.4a10.4 10.4 0 0 0 5 5l1.4-2 3.6 1.4v2.9a2.2 2.2 0 0 1-2.4 2.2C10.3 17.7 6.3 13.7 4 7.6a2.2 2.2 0 0 1 2.2-3.8z"
          {...s}
        />
      );
    case 'mail':
      return (
        <G {...s}>
          <Rect x="3" y="5.5" width="18" height="13" rx="3" />
          <Polyline points="4.2 7.5 12 13 19.8 7.5" />
        </G>
      );
    case 'credit-card':
      return (
        <G {...s}>
          <Rect x="2.8" y="5.5" width="18.4" height="13" rx="3" />
          <Line x1="2.8" y1="10" x2="21.2" y2="10" />
          <Line x1="6.5" y1="14.5" x2="10.5" y2="14.5" />
        </G>
      );
    case 'receipt':
      return (
        <G {...s}>
          <Path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8z" />
          <Line x1="9" y1="8" x2="15" y2="8" />
          <Line x1="9" y1="12" x2="15" y2="12" />
        </G>
      );
    case 'share':
      return (
        <G {...s}>
          <Circle cx="17.5" cy="6" r="2.6" />
          <Circle cx="6.5" cy="12" r="2.6" />
          <Circle cx="17.5" cy="18" r="2.6" />
          <Line x1="8.9" y1="10.7" x2="15.2" y2="7.3" />
          <Line x1="8.9" y1="13.3" x2="15.2" y2="16.7" />
        </G>
      );
    case 'download':
      return (
        <G {...s}>
          <Path d="M12 4v10.5" />
          <Polyline points="7.8 10.6 12 14.8 16.2 10.6" />
          <Path d="M4.5 17.5v1.2A1.8 1.8 0 0 0 6.3 20.5h11.4a1.8 1.8 0 0 0 1.8-1.8v-1.2" />
        </G>
      );
    case 'settings':
      return (
        <G {...s}>
          <Circle cx="12" cy="12" r="2.8" />
          <Path d="M12 3.2l1 2.2 2.4-.5 1.3 2 2.3.9-.6 2.4 1.5 1.9-1.5 1.9.6 2.4-2.3.9-1.3 2-2.4-.5-1 2.2-1-2.2-2.4.5-1.3-2-2.3-.9.6-2.4L3.1 12l1.5-1.9-.6-2.4 2.3-.9 1.3-2 2.4.5z" />
        </G>
      );
    case 'help':
      return (
        <G {...s}>
          <Circle cx="12" cy="12" r="8.25" />
          <Path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.5-1.2 1-1.2 1.8v.4" />
          <Circle cx="12" cy="16.4" r="0.9" fill={c} stroke="none" />
        </G>
      );
    case 'logout':
      return (
        <G {...s}>
          <Path d="M14 4.5H6.8A1.8 1.8 0 0 0 5 6.3v11.4a1.8 1.8 0 0 0 1.8 1.8H14" />
          <Polyline points="15.5 8.3 19.7 12 15.5 15.7" />
          <Line x1="9.5" y1="12" x2="19.7" y2="12" />
        </G>
      );
    case 'trash':
      return (
        <G {...s}>
          <Path d="M4.5 6.8h15" />
          <Path d="M9.3 6.8V5.2A1.2 1.2 0 0 1 10.5 4h3a1.2 1.2 0 0 1 1.2 1.2v1.6" />
          <Path d="M6.4 6.8l.9 12a1.6 1.6 0 0 0 1.6 1.5h6.2a1.6 1.6 0 0 0 1.6-1.5l.9-12" />
          <Line x1="10.4" y1="10.5" x2="10.7" y2="16.8" />
          <Line x1="13.6" y1="10.5" x2="13.3" y2="16.8" />
        </G>
      );
    case 'edit':
      return (
        <G {...s}>
          <Path d="M4.5 19.5h3.2L19 8.2a1.7 1.7 0 0 0 0-2.4l-.8-.8a1.7 1.7 0 0 0-2.4 0L4.5 16.3z" />
          <Line x1="14.2" y1="6.6" x2="17.4" y2="9.8" />
        </G>
      );
    case 'upload':
      return (
        <G {...s}>
          <Path d="M12 15V4.6" />
          <Polyline points="7.8 8.9 12 4.7 16.2 8.9" />
          <Path d="M4.5 16.8v1.9A1.8 1.8 0 0 0 6.3 20.5h11.4a1.8 1.8 0 0 0 1.8-1.8v-1.9" />
        </G>
      );
    case 'camera':
      return (
        <G {...s}>
          <Path d="M3.5 8.8h2.9l1.5-2.2h8.2l1.5 2.2h2.9a1 1 0 0 1 1 1v8.4a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V9.8a1 1 0 0 1 1-1z" />
          <Circle cx="12" cy="13.6" r="3.4" />
        </G>
      );
    case 'refresh':
      return (
        <G {...s}>
          <Path d="M20 12a8 8 0 1 1-2.6-5.9" />
          <Polyline points="20.2 4.4 20.2 9 15.6 9" />
        </G>
      );
    case 'lock':
      return (
        <G {...s}>
          <Rect x="4.8" y="10.2" width="14.4" height="10" rx="2.6" />
          <Path d="M8.4 10.2V8a3.6 3.6 0 0 1 7.2 0v2.2" />
        </G>
      );
    case 'shield-check':
      return (
        <G {...s}>
          <Path d="M12 3.5l7 2.4v5.4c0 4-2.9 7.5-7 9.2-4.1-1.7-7-5.2-7-9.2V5.9z" />
          <Polyline points="9 11.9 11.3 14.2 15.2 10.3" />
        </G>
      );
    case 'globe':
      return (
        <G {...s}>
          <Circle cx="12" cy="12" r="8.25" />
          <Path d="M3.9 9.5h16.2M3.9 14.5h16.2" />
          <Path d="M12 3.8c-2.4 2.3-3.6 5-3.6 8.2s1.2 5.9 3.6 8.2c2.4-2.3 3.6-5 3.6-8.2S14.4 6.1 12 3.8z" />
        </G>
      );
    case 'building':
      return (
        <G {...s}>
          <Rect x="4.5" y="3.8" width="15" height="16.7" rx="2.2" />
          <Line x1="8.8" y1="8" x2="8.8" y2="8.01" />
          <Line x1="12" y1="8" x2="12" y2="8.01" />
          <Line x1="15.2" y1="8" x2="15.2" y2="8.01" />
          <Line x1="8.8" y1="12" x2="8.8" y2="12.01" />
          <Line x1="12" y1="12" x2="12" y2="12.01" />
          <Line x1="15.2" y1="12" x2="15.2" y2="12.01" />
          <Path d="M10 20.5v-3.6h4v3.6" />
        </G>
      );
    case 'activity':
      return <Polyline points="3 12.5 7.5 12.5 10 6.5 13.5 18 16.5 12.5 21 12.5" {...s} />;
    case 'stethoscope':
      return (
        <G {...s}>
          <Path d="M6 4v5a4 4 0 0 0 8 0V4" />
          <Line x1="6" y1="4" x2="6" y2="6" />
          <Line x1="14" y1="4" x2="14" y2="6" />
          <Path d="M10 13v2.5a4.5 4.5 0 0 0 9 0v-1.6" />
          <Circle cx="19" cy="11.6" r="2.1" />
        </G>
      );
    case 'baby':
      return (
        <G {...s}>
          <Circle cx="12" cy="12" r="8.25" />
          <Circle cx="9.4" cy="10.6" r="0.9" fill={c} stroke="none" />
          <Circle cx="14.6" cy="10.6" r="0.9" fill={c} stroke="none" />
          <Path d="M9.2 15c.8.9 1.7 1.3 2.8 1.3s2-.4 2.8-1.3" />
        </G>
      );
    case 'brain':
      return (
        <G {...s}>
          <Path d="M12 5.2a3 3 0 0 0-5.5 1.6A2.7 2.7 0 0 0 4.6 10a2.9 2.9 0 0 0 1 2.2A2.8 2.8 0 0 0 6.9 17a3 3 0 0 0 5.1 1.3z" />
          <Path d="M12 5.2a3 3 0 0 1 5.5 1.6A2.7 2.7 0 0 1 19.4 10a2.9 2.9 0 0 1-1 2.2 2.8 2.8 0 0 1-1.3 4.8 3 3 0 0 1-5.1 1.3z" />
          <Line x1="12" y1="5.2" x2="12" y2="18.3" />
        </G>
      );
    case 'eye':
      return (
        <G {...s}>
          <Path d="M2.8 12S6.3 6.2 12 6.2 21.2 12 21.2 12 17.7 17.8 12 17.8 2.8 12 2.8 12z" />
          <Circle cx="12" cy="12" r="2.9" />
        </G>
      );
    case 'bone':
      return (
        <Path
          d="M8.4 15.6 15.6 8.4M6.3 17.7a2.6 2.6 0 0 1-3.7-3.7 2.6 2.6 0 0 1 3.6-3.6l3.5-3.5a2.6 2.6 0 0 1 3.6-3.6 2.6 2.6 0 1 1 3.7 3.7 2.6 2.6 0 0 1-3.6 3.6l-3.5 3.5a2.6 2.6 0 0 1-3.6 3.6z"
          {...s}
        />
      );
    case 'tooth':
      return (
        <Path
          d="M12 4.2c1.8 0 2.6-1 4.6-1 2.2 0 3.6 1.7 3.6 4.2 0 2.3-.8 3.4-1.4 5.6-.5 1.9-.6 4.6-1 6-.3 1.1-1.6 1.2-2 .1-.5-1.5-.6-4.6-1.6-6.1-.4-.6-1.4-.6-1.8 0-1 1.5-1.1 4.6-1.6 6.1-.4 1.1-1.7 1-2-.1-.4-1.4-.5-4.1-1-6C5.2 11.8 4.4 10.7 4.4 8.4c0-2.5 1.4-4.2 3.6-4.2 2 0 2.8 0 4 0z"
          {...s}
        />
      );
    case 'droplet':
      return <Path d="M12 3.6c3 3.6 5.4 6.4 5.4 9.4a5.4 5.4 0 0 1-10.8 0c0-3 2.4-5.8 5.4-9.4z" {...s} />;
    case 'sparkle':
      return (
        <G {...s}>
          <Path d="M12 3.6l1.9 5 5 1.9-5 1.9-1.9 5-1.9-5-5-1.9 5-1.9z" />
          <Path d="M18.6 15.4l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" />
        </G>
      );
    case 'briefcase':
      return (
        <G {...s}>
          <Rect x="3.2" y="7.4" width="17.6" height="12" rx="2.6" />
          <Path d="M9.2 7.4V6a1.8 1.8 0 0 1 1.8-1.8h2a1.8 1.8 0 0 1 1.8 1.8v1.4" />
          <Line x1="3.2" y1="12.4" x2="20.8" y2="12.4" />
        </G>
      );
    case 'sun':
      return (
        <G {...s}>
          <Circle cx="12" cy="12" r="4" />
          <Path d="M12 2.6v2.2M12 19.2v2.2M4.7 4.7l1.6 1.6M17.7 17.7l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.7 19.3l1.6-1.6M17.7 6.3l1.6-1.6" />
        </G>
      );
    case 'link':
      return (
        <G {...s}>
          <Path d="M10.4 13.6a3.6 3.6 0 0 0 5.4.4l2.4-2.4a3.6 3.6 0 0 0-5.1-5.1l-1.1 1.1" />
          <Path d="M13.6 10.4a3.6 3.6 0 0 0-5.4-.4l-2.4 2.4a3.6 3.6 0 0 0 5.1 5.1l1.1-1.1" />
        </G>
      );
    case 'unlink':
      return (
        <G {...s}>
          <Path d="M10.4 13.6a3.6 3.6 0 0 0 5.4.4l1.2-1.2" />
          <Path d="M13.6 10.4a3.6 3.6 0 0 0-5.4-.4l-1.2 1.2" />
          <Line x1="4" y1="4" x2="20" y2="20" />
        </G>
      );
    case 'more':
      return (
        <G {...s}>
          <Circle cx="6" cy="12" r="1.4" fill={c} stroke="none" />
          <Circle cx="12" cy="12" r="1.4" fill={c} stroke="none" />
          <Circle cx="18" cy="12" r="1.4" fill={c} stroke="none" />
        </G>
      );
    case 'grid':
      return (
        <G {...s}>
          <Rect x="4" y="4" width="6.6" height="6.6" rx="2" />
          <Rect x="13.4" y="4" width="6.6" height="6.6" rx="2" />
          <Rect x="4" y="13.4" width="6.6" height="6.6" rx="2" />
          <Rect x="13.4" y="13.4" width="6.6" height="6.6" rx="2" />
        </G>
      );
    case 'list':
      return (
        <G {...s}>
          <Line x1="8" y1="6.5" x2="20" y2="6.5" />
          <Line x1="8" y1="12" x2="20" y2="12" />
          <Line x1="8" y1="17.5" x2="20" y2="17.5" />
          <Circle cx="4.6" cy="6.5" r="1.2" fill={c} stroke="none" />
          <Circle cx="4.6" cy="12" r="1.2" fill={c} stroke="none" />
          <Circle cx="4.6" cy="17.5" r="1.2" fill={c} stroke="none" />
        </G>
      );
    case 'external-link':
      return (
        <G {...s}>
          <Path d="M13.6 4.5h5.9v5.9" />
          <Line x1="19.5" y1="4.5" x2="11.4" y2="12.6" />
          <Path d="M18 14.2v3.9a1.9 1.9 0 0 1-1.9 1.9H5.9A1.9 1.9 0 0 1 4 18.1V7.9A1.9 1.9 0 0 1 5.9 6h3.9" />
        </G>
      );
    default:
      return <Circle cx="12" cy="12" r="8" {...s} />;
  }
}

/**
 * Brand icon. Decorative unless `accessibilityLabel` is provided.
 */
export function Icon({
  name,
  size = 22,
  color: iconColor = color.dark,
  strokeWidth,
  accessibilityLabel,
}: IconProps) {
  const sw = strokeWidth ?? Math.max(1.5, (size / 24) * 1.9);
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessible={accessibilityLabel !== undefined}
      accessibilityRole={accessibilityLabel ? 'image' : 'none'}
      accessibilityLabel={accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}
    >
      {shapes(name, sw, iconColor)}
    </Svg>
  );
}

export type { IconName as BrandIconName };
