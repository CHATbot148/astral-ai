import { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Download, Share2, Pencil, Eraser, Undo2, Send, RotateCcw, ZoomIn, ZoomOut, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export type MediaViewerKind = 'image' | 'ai-image' | 'video' | 'document' | 'audio';

export interface MediaViewerProps {
  open: boolean;
  url: string;
  kind: MediaViewerKind;
  fileName?: string;
  mimeType?: string;
  onClose: () => void;
  /** Called when user wants to edit AI image with a mask + prompt. */
  onEditWithMask?: (input: { maskDataUrl: string; prompt: string; referenceFile?: File | null }) => void;
  /** Called when user annotates an attachment image and sends back to chat. */
  onSendAnnotated?: (input: { annotatedDataUrl: string; prompt: string }) => void;
}

const downloadBlobFromUrl = async (url: string, suggestedName: string) => {
  try {
    const res = await fetch(url, { mode: 'cors' });
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    return true;
  } catch {
    // Fallback: open in new tab
    window.open(url, '_blank', 'noopener,noreferrer');
    return false;
  }
};

export const MediaViewer = ({
  open,
  url,
  kind,
  fileName,
  mimeType,
  onClose,
  onEditWithMask,
  onSendAnnotated,
}: MediaViewerProps) => {
  const { toast } = useToast();
  const [mode, setMode] = useState<'view' | 'edit' | 'annotate'>('view');

  // Reset to view whenever opened/url changes
  useEffect(() => {
    if (open) setMode('view');
  }, [open, url]);

  // Lock body scroll + prevent iOS rubber-band while open
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const appRoot = document.getElementById('root');
    const prevOverflow = document.body.style.overflow;
    const prevOverscroll = document.body.style.overscrollBehavior;
    const prevTouch = (document.body.style as any).touchAction;
    const prevBodyPosition = document.body.style.position;
    const prevBodyWidth = document.body.style.width;
    const prevBodyTop = document.body.style.top;
    const prevHtmlOverflow = html.style.overflow;
    const prevHtmlOverscroll = html.style.overscrollBehavior;
    const prevRootPointerEvents = appRoot?.style.pointerEvents;
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'contain';
    html.style.overscrollBehavior = 'none';
    (document.body.style as any).touchAction = 'none';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${scrollY}px`;
    if (appRoot) appRoot.style.pointerEvents = 'none';
    return () => {
      document.body.style.overflow = prevOverflow;
      html.style.overflow = prevHtmlOverflow;
      document.body.style.overscrollBehavior = prevOverscroll;
      html.style.overscrollBehavior = prevHtmlOverscroll;
      (document.body.style as any).touchAction = prevTouch;
      document.body.style.position = prevBodyPosition;
      document.body.style.width = prevBodyWidth;
      document.body.style.top = prevBodyTop;
      if (appRoot) appRoot.style.pointerEvents = prevRootPointerEvents ?? '';
      window.scrollTo(0, scrollY);
    };
  }, [open]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleDownload = async () => {
    const ext = (mimeType?.split('/')[1] || url.split('.').pop()?.split('?')[0] || 'file').slice(0, 6);
    const name = fileName || `astraz-${Date.now()}.${ext}`;
    await downloadBlobFromUrl(url, name);
    toast({ title: 'Download started' });
  };

  const handleShare = async () => {
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try { await (navigator as any).share({ url, title: fileName || 'Astraz attachment' }); } catch {}
    } else {
      await navigator.clipboard.writeText(url);
      toast({ title: 'Link copied' });
    }
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[200] flex flex-col bg-[#050507]/95 backdrop-blur-xl overscroll-contain"
        style={{ touchAction: 'none' }}
        data-allow-scroll="false"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => {
          // Allow touchmove only inside scrollable panes (img/text/pdf containers handle it)
          const target = e.target as HTMLElement;
          if (!target.closest('[data-allow-scroll]')) e.preventDefault();
        }}
      >
        {/* Top bar */}
        <div className="flex items-center justify-between gap-2 px-3 sm:px-5 py-3 border-b border-white/10 bg-black/40 backdrop-blur-md">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-xai-purple to-xai-cyan flex items-center justify-center">
              {kind === 'document' ? <FileText className="h-4 w-4 text-white" /> : <span className="text-[10px] font-bold text-white">A</span>}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white truncate max-w-[60vw] sm:max-w-md">
                {fileName || (kind === 'ai-image' ? 'Generated image' : kind === 'video' ? 'Video' : kind === 'document' ? 'Document' : 'Attachment')}
              </div>
              <div className="text-[10.5px] uppercase tracking-wider text-white/50">
                {mode === 'edit' ? 'Edit mode' : mode === 'annotate' ? 'Annotate' : kind.replace('-', ' ')}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {mode === 'view' && (
              <>
                {(kind === 'image' || kind === 'ai-image' || kind === 'video' || kind === 'document') && (
                  <Button variant="ghost" size="sm" onClick={handleDownload} className="text-white/80 hover:text-white hover:bg-white/10 gap-1.5">
                    <Download className="h-4 w-4" />
                    <span className="hidden sm:inline">Download</span>
                  </Button>
                )}
                {kind === 'ai-image' && onEditWithMask && (
                  <Button variant="ghost" size="sm" onClick={() => setMode('edit')} className="text-white/80 hover:text-white hover:bg-white/10 gap-1.5">
                    <Pencil className="h-4 w-4" />
                    <span className="hidden sm:inline">Edit</span>
                  </Button>
                )}
                {kind === 'image' && onSendAnnotated && (
                  <Button variant="ghost" size="sm" onClick={() => setMode('annotate')} className="text-white/80 hover:text-white hover:bg-white/10 gap-1.5">
                    <Pencil className="h-4 w-4" />
                    <span className="hidden sm:inline">Annotate</span>
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={handleShare} className="text-white/80 hover:text-white hover:bg-white/10 gap-1.5 hidden sm:inline-flex">
                  <Share2 className="h-4 w-4" />
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon" onClick={onClose} className="text-white hover:bg-white/15 h-9 w-9 rounded-full">
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {mode === 'view' && kind === 'video' && <VideoPane url={url} />}
          {mode === 'view' && (kind === 'image' || kind === 'ai-image') && <ImagePane url={url} />}
          {mode === 'view' && kind === 'document' && <DocumentPane url={url} fileName={fileName} mimeType={mimeType} />}
          {mode === 'view' && kind === 'audio' && (
            <div className="h-full flex items-center justify-center p-6">
              <audio src={url} controls className="w-full max-w-md" />
            </div>
          )}
          {mode === 'annotate' && (
            <AnnotatePane
              url={url}
              onCancel={() => setMode('view')}
              onSubmit={(payload) => { onSendAnnotated?.(payload); onClose(); }}
            />
          )}
          {mode === 'edit' && (
            <BrushMaskEditor
              url={url}
              onCancel={() => setMode('view')}
              onSubmit={(payload) => { onEditWithMask?.(payload); onClose(); }}
            />
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

/* ---------------- Video pane ---------------- */
const VideoPane = ({ url }: { url: string }) => (
  <div className="h-full w-full flex items-center justify-center p-2 sm:p-6">
    <video
      src={url}
      controls
      autoPlay
      playsInline
      controlsList="nodownload"
      className="max-h-full max-w-full rounded-xl shadow-2xl bg-black"
    />
  </div>
);

/* ---------------- Image pane with pinch/zoom ---------------- */
const ImagePane = ({ url }: { url: string }) => {
  const [scale, setScale] = useState(1);
  return (
    <div className="relative h-full w-full overflow-auto flex items-center justify-center p-2 sm:p-6">
      <img
        src={url}
        alt="Preview"
        style={{ transform: `scale(${scale})`, transition: 'transform 200ms ease' }}
        className="max-h-full max-w-full object-contain rounded-xl shadow-2xl"
      />
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1 rounded-full bg-black/70 backdrop-blur border border-white/10">
        <Button variant="ghost" size="icon" onClick={() => setScale((s) => Math.max(0.5, s - 0.2))} className="h-8 w-8 text-white hover:bg-white/15"><ZoomOut className="h-4 w-4" /></Button>
        <span className="text-[11px] text-white/80 w-12 text-center font-mono">{Math.round(scale * 100)}%</span>
        <Button variant="ghost" size="icon" onClick={() => setScale((s) => Math.min(4, s + 0.2))} className="h-8 w-8 text-white hover:bg-white/15"><ZoomIn className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" onClick={() => setScale(1)} className="h-8 w-8 text-white hover:bg-white/15"><RotateCcw className="h-4 w-4" /></Button>
      </div>
    </div>
  );
};

/* ---------------- Document pane ---------------- */
const DocumentPane = ({ url, fileName, mimeType }: { url: string; fileName?: string; mimeType?: string }) => {
  const isPdf = (mimeType === 'application/pdf') || /\.pdf(\?|$)/i.test(url) || /\.pdf$/i.test(fileName || '');
  const isText = /^text\//i.test(mimeType || '') || /\.(txt|md|csv|json|log)$/i.test(fileName || '');

  if (isPdf) {
    return (
      <div className="h-full w-full p-2 sm:p-4">
        <iframe
          src={`${url}#view=FitH`}
          title={fileName || 'Document'}
          className="w-full h-full rounded-xl border border-white/10 bg-white"
        />
      </div>
    );
  }

  if (isText) {
    return <TextDocumentPane url={url} />;
  }

  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-xai-purple to-xai-cyan flex items-center justify-center">
        <FileText className="h-8 w-8 text-white" />
      </div>
      <div>
        <div className="text-base font-semibold text-white">{fileName || 'File'}</div>
        <div className="text-xs text-white/60 mt-1">Preview not available for this file type</div>
      </div>
      <Button variant="secondary" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')} className="gap-2">
        <Download className="h-4 w-4" />
        Open / Download
      </Button>
    </div>
  );
};

const TextDocumentPane = ({ url }: { url: string }) => {
  const [content, setContent] = useState<string>('Loading…');
  useEffect(() => {
    let cancelled = false;
    fetch(url).then(r => r.text()).then((t) => { if (!cancelled) setContent(t.slice(0, 200_000)); })
      .catch(() => { if (!cancelled) setContent('Unable to load file.'); });
    return () => { cancelled = true; };
  }, [url]);
  return (
    <div className="h-full w-full p-2 sm:p-4">
      <pre className="h-full w-full overflow-auto rounded-xl border border-white/10 bg-black/40 p-4 text-[13px] leading-relaxed text-white/90 font-mono whitespace-pre-wrap">{content}</pre>
    </div>
  );
};

/* ---------------- Annotate pane (free-draw circles/lines) ---------------- */
const AnnotatePane = ({
  url,
  onCancel,
  onSubmit,
}: {
  url: string;
  onCancel: () => void;
  onSubmit: (input: { annotatedDataUrl: string; prompt: string }) => void;
}) => {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const strokesRef = useRef<ImageData[]>([]);
  const [prompt, setPrompt] = useState('');

  const sync = useCallback(() => {
    const img = imgRef.current; const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const rect = img.getBoundingClientRect();
    canvas.width = rect.width; canvas.height = rect.height;
    canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
  }, []);

  useEffect(() => {
    const handler = () => sync();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [sync]);

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    drawingRef.current = true;
    lastRef.current = pos(e);
    const ctx = canvasRef.current!.getContext('2d')!;
    strokesRef.current.push(ctx.getImageData(0, 0, canvasRef.current!.width, canvasRef.current!.height));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const p = pos(e); const l = lastRef.current!;
    ctx.strokeStyle = '#ff3366'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    lastRef.current = p;
  };
  const onPointerUp = () => { drawingRef.current = false; lastRef.current = null; };

  const undo = () => {
    const ctx = canvasRef.current?.getContext('2d');
    const last = strokesRef.current.pop();
    if (ctx && last) ctx.putImageData(last, 0, 0);
  };
  const clear = () => {
    strokesRef.current = [];
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const handleSend = async () => {
    const img = imgRef.current; const canvas = canvasRef.current;
    if (!img || !canvas) return;
    // Composite original + annotations
    const out = document.createElement('canvas');
    const naturalScale = img.naturalWidth / canvas.width;
    out.width = img.naturalWidth;
    out.height = img.naturalHeight;
    const octx = out.getContext('2d')!;
    octx.drawImage(img, 0, 0, out.width, out.height);
    octx.drawImage(canvas, 0, 0, canvas.width * naturalScale, canvas.height * naturalScale);
    const dataUrl = out.toDataURL('image/png');
    onSubmit({
      annotatedDataUrl: dataUrl,
      prompt: prompt.trim() || 'I\'m pointing to the highlighted area in this image. What do you see?',
    });
  };

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 min-h-0 relative flex items-center justify-center p-2 sm:p-4">
        <div className="relative inline-block max-h-full max-w-full">
          <img
            ref={imgRef}
            src={url}
            alt=""
            onLoad={sync}
            crossOrigin="anonymous"
            className="block max-h-[calc(100dvh-260px)] max-w-full rounded-xl shadow-2xl pointer-events-none select-none"
          />
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            className="absolute inset-0 cursor-crosshair touch-none"
          />
        </div>
      </div>
      <div className="border-t border-white/10 bg-black/60 backdrop-blur-md p-3 space-y-2">
        <div className="flex items-center gap-2 justify-center">
          <Button variant="secondary" size="sm" onClick={undo} className="gap-1.5"><Undo2 className="h-3.5 w-3.5" /> Undo</Button>
          <Button variant="secondary" size="sm" onClick={clear} className="gap-1.5"><Eraser className="h-3.5 w-3.5" /> Clear</Button>
        </div>
        <div className="flex items-end gap-2 max-w-2xl mx-auto">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Tell Astraz what to focus on… (optional)"
            rows={2}
            className="bg-white/5 border-white/15 text-white placeholder:text-white/40 resize-none"
          />
          <div className="flex flex-col gap-1">
            <Button variant="ghost" onClick={onCancel} className="text-white/80 hover:bg-white/10">Cancel</Button>
            <Button onClick={handleSend} className="gap-1.5 bg-gradient-to-r from-xai-purple to-xai-cyan text-white"><Send className="h-4 w-4" /> Send</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ---------------- Brush mask editor for AI image inpainting ---------------- */
const BrushMaskEditor = ({
  url,
  onCancel,
  onSubmit,
}: {
  url: string;
  onCancel: () => void;
  onSubmit: (input: { maskDataUrl: string; prompt: string; referenceFile?: File | null }) => void;
}) => {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const [brushSize, setBrushSize] = useState(40);
  const [prompt, setPrompt] = useState('');
  const [refFile, setRefFile] = useState<File | null>(null);

  const sync = useCallback(() => {
    const img = imgRef.current; const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const rect = img.getBoundingClientRect();
    canvas.width = rect.width; canvas.height = rect.height;
    canvas.style.width = `${rect.width}px`; canvas.style.height = `${rect.height}px`;
  }, []);

  useEffect(() => {
    const h = () => sync();
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, [sync]);

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const paintAt = (p: { x: number; y: number }) => {
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.fillStyle = 'rgba(60, 220, 255, 0.55)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
    if (lastRef.current) {
      ctx.strokeStyle = 'rgba(60, 220, 255, 0.55)';
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(lastRef.current.x, lastRef.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    lastRef.current = p;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    drawingRef.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    historyRef.current.push(ctx.getImageData(0, 0, canvasRef.current!.width, canvasRef.current!.height));
    paintAt(pos(e));
  };
  const onPointerMove = (e: React.PointerEvent) => { if (drawingRef.current) paintAt(pos(e)); };
  const onPointerUp = () => { drawingRef.current = false; lastRef.current = null; };

  const undo = () => {
    const ctx = canvasRef.current?.getContext('2d');
    const last = historyRef.current.pop();
    if (ctx && last) ctx.putImageData(last, 0, 0);
  };
  const clear = () => {
    historyRef.current = [];
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && canvasRef.current) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
  };

  const handleSubmit = async () => {
    if (!prompt.trim()) { return; }
    const img = imgRef.current; const canvas = canvasRef.current;
    if (!img || !canvas) return;
    // Build pure black/white mask at natural resolution (white = edit)
    const out = document.createElement('canvas');
    out.width = img.naturalWidth; out.height = img.naturalHeight;
    const octx = out.getContext('2d')!;
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, out.width, out.height);
    octx.fillStyle = '#fff';
    octx.drawImage(canvas, 0, 0, out.width, out.height);
    // Threshold to pure white where painted
    const id = octx.getImageData(0, 0, out.width, out.height);
    for (let i = 0; i < id.data.length; i += 4) {
      const a = id.data[i + 3];
      const lum = (id.data[i] + id.data[i + 1] + id.data[i + 2]) / 3;
      const on = a > 20 && lum > 80;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = on ? 255 : 0;
      id.data[i + 3] = 255;
    }
    octx.putImageData(id, 0, 0);
    onSubmit({ maskDataUrl: out.toDataURL('image/png'), prompt: prompt.trim(), referenceFile: refFile });
  };

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 min-h-0 relative flex items-center justify-center p-2 sm:p-4">
        <div className="relative inline-block max-h-full max-w-full">
          <img
            ref={imgRef}
            src={url}
            onLoad={sync}
            crossOrigin="anonymous"
            alt=""
            className="block max-h-[calc(100dvh-330px)] max-w-full rounded-xl shadow-2xl pointer-events-none select-none"
          />
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            className="absolute inset-0 cursor-crosshair touch-none"
          />
        </div>
      </div>
      <div className="border-t border-white/10 bg-black/60 backdrop-blur-md p-3 space-y-3">
        <div className="flex items-center gap-3 max-w-2xl mx-auto">
          <span className="text-[11px] uppercase tracking-wider text-white/60 w-16">Brush</span>
          <Slider value={[brushSize]} onValueChange={(v) => setBrushSize(v[0])} min={8} max={120} step={2} className="flex-1" />
          <span className="text-xs text-white/70 font-mono w-10 text-right">{brushSize}px</span>
          <Button variant="secondary" size="sm" onClick={undo} className="gap-1.5"><Undo2 className="h-3.5 w-3.5" /> Undo</Button>
          <Button variant="secondary" size="sm" onClick={clear} className="gap-1.5"><Eraser className="h-3.5 w-3.5" /> Clear</Button>
        </div>
        <div className="flex items-end gap-2 max-w-2xl mx-auto">
          <div className="flex-1 space-y-1.5">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the edit — e.g. 'replace with a red sports car'"
              rows={2}
              className="bg-white/5 border-white/15 text-white placeholder:text-white/40 resize-none"
            />
            <label className={cn(
              'inline-flex items-center gap-1.5 text-[11px] text-white/60 hover:text-white/90 cursor-pointer',
              refFile && 'text-xai-cyan'
            )}>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setRefFile(e.target.files?.[0] || null)}
              />
              <ImageRefIcon /> {refFile ? refFile.name.slice(0, 20) : 'Add reference image (optional)'}
            </label>
          </div>
          <div className="flex flex-col gap-1">
            <Button variant="ghost" onClick={onCancel} className="text-white/80 hover:bg-white/10">Cancel</Button>
            <Button onClick={handleSubmit} disabled={!prompt.trim()} className="gap-1.5 bg-gradient-to-r from-xai-purple to-xai-cyan text-white">
              <Send className="h-4 w-4" /> Edit
            </Button>
          </div>
        </div>
        <p className="text-[10.5px] text-center text-white/40">Paint over the area you want changed, then describe the edit.</p>
      </div>
    </div>
  );
};

const ImageRefIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
  </svg>
);
