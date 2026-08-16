// 会社ロゴ（青地に白のひし形と社名）。画像ではなくSVGで描くことで、
// どの表示サイズでも輪郭が滲まず、色の調整も一箇所で済むようにしている。
export default function RyoshinLogo({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="株式会社良心">
      <rect width="100" height="100" fill="#1E90FF" />
      <rect
        x="24" y="24" width="52" height="52" rx="9"
        transform="rotate(45 50 50)"
        fill="none" stroke="#fff" strokeWidth="2.6"
      />
      {/* textLengthで文字幅を固定し、端末のフォント差でひし形からはみ出さないようにする */}
      <text
        x="50" y="50"
        textAnchor="middle" dominantBaseline="central"
        fill="#fff" fontSize="15" fontWeight="700"
        fontFamily="Helvetica, Arial, sans-serif"
        textLength="47" lengthAdjust="spacingAndGlyphs"
      >
        Ryoshin
      </text>
    </svg>
  )
}
