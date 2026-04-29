type LogoProps = {
  height?: number;
  accent?: string;
  muted?: string;
};

export function Logo({ height = 22, accent = '#3861fb', muted = '#e1e4e8' }: LogoProps) {
  return (
    <svg
      height={height}
      viewBox="0 0 132 28"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Open Hype"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <g fill="none" stroke={accent} strokeWidth="2.6" strokeLinecap="square" strokeLinejoin="miter">
        <polyline points="10,4 4,14 10,24" />
        <polyline points="18,18 24,8 30,18" />
      </g>
      <text
        x="40"
        y="20"
        fontFamily="ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
        fontSize="15"
        fontWeight="500"
        fill={muted}
        letterSpacing="0.5"
      >
        open
      </text>
      <text
        x="84"
        y="20"
        fontFamily="ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
        fontSize="15"
        fontWeight="800"
        fill={accent}
        letterSpacing="0.5"
      >
        hype
      </text>
    </svg>
  );
}
