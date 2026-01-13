import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Check, X, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';

interface ImageCropperProps {
  imageSrc: string;
  onCropComplete: (croppedBlob: Blob) => void;
  onCancel: () => void;
}

export const ImageCropper = ({ imageSrc, onCropComplete, onCancel }: ImageCropperProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);

  const CROP_SIZE = 200;

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imageRef.current = img;
      setImageLoaded(true);
      // Center the image initially
      setPosition({ x: 0, y: 0 });
    };
    img.src = imageSrc;
  }, [imageSrc]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  }, [isDragging, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Touch support
  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({ x: touch.clientX - position.x, y: touch.clientY - position.y });
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    const touch = e.touches[0];
    setPosition({
      x: touch.clientX - dragStart.x,
      y: touch.clientY - dragStart.y,
    });
  };

  const handleCrop = () => {
    if (!canvasRef.current || !imageRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = imageRef.current;
    const outputSize = 256; // Output resolution
    canvas.width = outputSize;
    canvas.height = outputSize;

    // Create circular clip
    ctx.beginPath();
    ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();

    // Calculate the source rectangle from the image
    const imgWidth = img.naturalWidth;
    const imgHeight = img.naturalHeight;
    const displayScale = Math.min(300 / imgWidth, 300 / imgHeight) * scale;
    
    // The visible area in image coordinates
    const cropCenterX = imgWidth / 2 - position.x / displayScale;
    const cropCenterY = imgHeight / 2 - position.y / displayScale;
    const cropRadius = (CROP_SIZE / 2) / displayScale;

    // Draw the cropped portion
    ctx.drawImage(
      img,
      cropCenterX - cropRadius,
      cropCenterY - cropRadius,
      cropRadius * 2,
      cropRadius * 2,
      0,
      0,
      outputSize,
      outputSize
    );

    canvas.toBlob((blob) => {
      if (blob) {
        onCropComplete(blob);
      }
    }, 'image/png', 1);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        className="bg-card rounded-xl p-6 max-w-sm w-full"
      >
        <h3 className="text-lg font-semibold mb-4 text-center">Crop Your Photo</h3>
        
        {/* Crop Area */}
        <div 
          ref={containerRef}
          className="relative w-[300px] h-[300px] mx-auto overflow-hidden bg-black rounded-lg cursor-move"
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={() => setIsDragging(false)}
        >
          {imageLoaded && imageRef.current && (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) scale(${scale})`,
                transformOrigin: 'center',
                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
              }}
            >
              <img
                src={imageSrc}
                alt="Crop preview"
                className="max-w-none pointer-events-none"
                style={{ maxWidth: '300px', maxHeight: '300px', objectFit: 'contain' }}
                draggable={false}
              />
            </div>
          )}
          
          {/* Circular overlay mask */}
          <div className="absolute inset-0 pointer-events-none">
            <svg width="300" height="300" className="absolute inset-0">
              <defs>
                <mask id="circleMask">
                  <rect width="300" height="300" fill="white" />
                  <circle cx="150" cy="150" r={CROP_SIZE / 2} fill="black" />
                </mask>
              </defs>
              <rect width="300" height="300" fill="rgba(0,0,0,0.6)" mask="url(#circleMask)" />
              <circle
                cx="150"
                cy="150"
                r={CROP_SIZE / 2}
                fill="none"
                stroke="rgba(0, 212, 255, 0.8)"
                strokeWidth="2"
                strokeDasharray="8 4"
              />
            </svg>
          </div>
        </div>

        {/* Zoom Control */}
        <div className="flex items-center gap-3 mt-4 px-2">
          <ZoomOut className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Slider
            value={[scale]}
            onValueChange={([v]) => setScale(v)}
            min={0.5}
            max={3}
            step={0.1}
            className="flex-1"
          />
          <ZoomIn className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        </div>

        <p className="text-xs text-muted-foreground text-center mt-2">
          Drag to position • Pinch or slider to zoom
        </p>

        {/* Actions */}
        <div className="flex gap-3 mt-4">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button variant="xai" onClick={handleCrop} className="flex-1">
            <Check className="h-4 w-4 mr-1" />
            Apply
          </Button>
        </div>

        {/* Hidden canvas for cropping */}
        <canvas ref={canvasRef} className="hidden" />
      </motion.div>
    </motion.div>
  );
};
