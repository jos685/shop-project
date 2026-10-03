export default function AddToast({
    text, onEdit, onUndo, theme, bottomOffset = 64,
  }: {
    text: string;
    onEdit?: () => void;
    onUndo: () => void;
    theme: any;
    bottomOffset?: number;
  }) {
    return (
      <div style={{
        position: "fixed",
        left: 10, right: 10,
        bottom: `calc(env(safe-area-inset-bottom, 0px) + ${bottomOffset + 74}px)`,
        zIndex: 45,
        background: theme.bg.card,
        border: `1px solid ${theme.border.default}`,
        borderRadius: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        padding: "10px 12px",
        display: "flex", alignItems: "center", gap: 8,
        maxWidth: 520,
        marginLeft: "auto", marginRight: "auto",
        animation: "fadeUp 0.2s ease both",
      }}>
        <span style={{ color: theme.accent.green, fontSize: 14, flexShrink: 0 }}>✓</span>
        <span style={{
          flex: 1, minWidth: 0,
          fontFamily: theme.font.mono, fontSize: 12,
          color: theme.text.primary,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {text}
        </span>
        {onEdit && (
          <button onClick={onEdit} style={{
            background: "none", border: "none", cursor: "pointer",
            color: theme.accent.cyan, fontSize: 11,
            fontFamily: theme.font.mono, fontWeight: 700,
            padding: "4px 6px", flexShrink: 0,
          }}>
            Edit
          </button>
        )}
        <button onClick={onUndo} style={{
          background: "none", border: "none", cursor: "pointer",
          color: theme.text.muted, fontSize: 11,
          fontFamily: theme.font.mono,
          padding: "4px 6px", flexShrink: 0,
        }}>
          Undo
        </button>
      </div>
    );
  }