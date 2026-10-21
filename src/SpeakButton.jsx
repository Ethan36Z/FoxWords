import { canSpeak, speak } from "./speech";

// Round speaker icon that reads `text` aloud
function SpeakButton({ text, label = "发音", size = "md", rate, className = "" }) {
  if (!canSpeak) return null;
  return (
    <button
      type="button"
      className={`icon-btn icon-btn--${size} ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        speak(text, { rate });
      }}
      title={label}
      aria-label={`${label}：${text}`}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" fill="currentColor" />
        <path
          d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4M18 6.3a8 8 0 0 1 0 11.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

export default SpeakButton;
