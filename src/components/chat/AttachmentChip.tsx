import { motion } from 'framer-motion';
import { FileText, Image as ImageIcon, Film, Music, FileSpreadsheet, FileCode, FileType, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AttachmentChipProps {
  name: string;
  size?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  onClick?: () => void;
  onRemove?: () => void;
  className?: string;
}

const TRUNCATE = 10;

const truncateName = (name: string) => {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) {
    return name.length > TRUNCATE ? name.slice(0, TRUNCATE) + '…' : name;
  }
  const base = name.slice(0, dot);
  const ext = name.slice(dot);
  if (base.length <= TRUNCATE) return name;
  return base.slice(0, TRUNCATE) + '…' + ext;
};

const formatSize = (bytes?: number) => {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${bytes} B`;
};

const pickIcon = (mime?: string, name?: string) => {
  const m = (mime || '').toLowerCase();
  const n = (name || '').toLowerCase();
  if (m.startsWith('image/')) return { Icon: ImageIcon, label: 'Image', tint: 'from-fuchsia-500 to-pink-500' };
  if (m.startsWith('video/')) return { Icon: Film, label: 'Video', tint: 'from-rose-500 to-orange-500' };
  if (m.startsWith('audio/')) return { Icon: Music, label: 'Audio', tint: 'from-amber-500 to-yellow-500' };
  if (m === 'application/pdf' || n.endsWith('.pdf')) return { Icon: FileType, label: 'PDF', tint: 'from-red-500 to-rose-600' };
  if (m.includes('spreadsheet') || /\.(xlsx?|csv|numbers)$/.test(n)) return { Icon: FileSpreadsheet, label: 'Sheet', tint: 'from-emerald-500 to-green-600' };
  if (m.includes('word') || /\.(docx?|pages|rtf|odt)$/.test(n)) return { Icon: FileText, label: 'Doc', tint: 'from-sky-500 to-blue-600' };
  if (/\.(json|xml|yml|yaml|ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|hpp|sh|sql|md)$/.test(n)) return { Icon: FileCode, label: 'Code', tint: 'from-violet-500 to-indigo-600' };
  return { Icon: FileText, label: 'File', tint: 'from-slate-500 to-slate-700' };
};

const formatLabel = (mime?: string, name?: string) => {
  const ext = name?.split('.').pop();
  if (ext && ext.length <= 5) return ext.toUpperCase();
  return pickIcon(mime, name).label;
};

export const AttachmentChip = ({
  name,
  size,
  mimeType,
  thumbnailUrl,
  onClick,
  onRemove,
  className,
}: AttachmentChipProps) => {
  const { Icon, tint } = pickIcon(mimeType, name);
  const sizeText = formatSize(size);
  const typeLabel = formatLabel(mimeType, name);
  const isImage = (mimeType || '').startsWith('image/');
  const isVideo = (mimeType || '').startsWith('video/');
  const isTextPreview = !!thumbnailUrl && !isImage && !isVideo;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn('relative inline-block', className)}
    >
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'group flex items-center gap-2.5 max-w-[260px] sm:max-w-[280px]',
          'pl-1.5 pr-3 py-1.5 rounded-2xl',
          'bg-secondary/70 hover:bg-secondary border border-border/60',
          'shadow-sm hover:shadow-md hover:border-xai-cyan/40',
          'transition-all duration-200 text-left'
        )}
      >
        <div className={cn(
          'relative h-10 w-10 shrink-0 rounded-xl overflow-hidden',
          'bg-gradient-to-br shadow-inner',
          tint
        )}>
          {thumbnailUrl && (isImage || isVideo) ? (
            <img src={thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : isTextPreview ? (
            <div className="absolute inset-0 bg-background/95 px-1.5 py-1 text-[5px] leading-tight text-foreground/80 overflow-hidden whitespace-pre-wrap">
              {thumbnailUrl}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-white">
              <Icon className="h-5 w-5" strokeWidth={2.2} />
            </div>
          )}
          {isVideo && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <span className="block w-0 h-0 border-y-[5px] border-y-transparent border-l-[7px] border-l-white ml-[2px]" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-foreground truncate leading-tight">
            {truncateName(name)}
          </div>
          <div className="text-[10.5px] text-muted-foreground/90 mt-0.5 font-medium tracking-wide">
            {typeLabel}{sizeText ? ` · ${sizeText}` : ''}
          </div>
        </div>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          aria-label="Remove attachment"
          className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-md hover:scale-110 transition-transform"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </motion.div>
  );
};
