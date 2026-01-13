/**
 * Utilitário para validação de qualidade de imagem
 * Verifica tamanho, resolução e formato antes de processar OCR
 */

// Limites configuráveis
const LIMITS = {
  MIN_FILE_SIZE_BYTES: 5 * 1024,        // 5KB - imagens muito pequenas são provavelmente ruins
  MAX_FILE_SIZE_BYTES: 20 * 1024 * 1024, // 20MB - limite para evitar abuse
  MIN_DIMENSION: 50,                     // Pixels mínimos (largura ou altura)
  MAX_DIMENSION: 10000,                  // Pixels máximos
  MIN_ASPECT_RATIO: 0.1,                 // Evita imagens muito estreitas (tipo linha)
  MAX_ASPECT_RATIO: 10,                  // Evita imagens muito longas
  VALID_MIME_TYPES: [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/bmp',
    'application/pdf'
  ]
};

/**
 * Extrai dimensões de uma imagem JPEG a partir do buffer
 * @param {Buffer} buffer 
 * @returns {{ width: number, height: number } | null}
 */
function getJpegDimensions(buffer) {
  try {
    // JPEG markers: FF C0 (baseline), FF C1 (extended sequential), FF C2 (progressive)
    let offset = 2; // Skip SOI marker (FF D8)
    
    while (offset < buffer.length - 8) {
      // Find marker
      if (buffer[offset] !== 0xFF) {
        offset++;
        continue;
      }
      
      const marker = buffer[offset + 1];
      
      // SOF0, SOF1, SOF2 markers contain dimensions
      if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { width, height };
      }
      
      // Skip to next marker
      if (marker >= 0xD0 && marker <= 0xD9) {
        // Standalone markers (no length)
        offset += 2;
      } else {
        // Marker with length
        const length = buffer.readUInt16BE(offset + 2);
        offset += 2 + length;
      }
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Extrai dimensões de uma imagem PNG a partir do buffer
 * @param {Buffer} buffer 
 * @returns {{ width: number, height: number } | null}
 */
function getPngDimensions(buffer) {
  try {
    // PNG IHDR chunk starts at offset 8 (after signature) + 8 (chunk length + type)
    // Width is at offset 16, Height is at offset 20 (both 4 bytes, big endian)
    if (buffer.length < 24) return null;
    
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    
    return { width, height };
  } catch (e) {
    return null;
  }
}

/**
 * Extrai dimensões de uma imagem WebP a partir do buffer
 * @param {Buffer} buffer 
 * @returns {{ width: number, height: number } | null}
 */
function getWebpDimensions(buffer) {
  try {
    // WebP has multiple formats (VP8, VP8L, VP8X)
    // VP8: dimensions at offset 26-29
    // VP8L: dimensions at offset 21-24
    
    if (buffer.length < 30) return null;
    
    // Check for VP8 (lossy)
    if (buffer.slice(12, 16).toString() === 'VP8 ') {
      // VP8 format - dimensions are at bytes 26-27 (width) and 28-29 (height), little endian
      const width = buffer.readUInt16LE(26) & 0x3FFF;
      const height = buffer.readUInt16LE(28) & 0x3FFF;
      return { width, height };
    }
    
    // Check for VP8L (lossless)
    if (buffer.slice(12, 16).toString() === 'VP8L') {
      // VP8L format - dimensions encoded differently
      const signature = buffer.readUInt32LE(21);
      const width = (signature & 0x3FFF) + 1;
      const height = ((signature >> 14) & 0x3FFF) + 1;
      return { width, height };
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Tenta extrair dimensões da imagem a partir do buffer
 * @param {Buffer} buffer 
 * @param {string} mimeType 
 * @returns {{ width: number, height: number } | null}
 */
function getImageDimensions(buffer, mimeType) {
  switch (mimeType) {
    case 'image/jpeg':
      return getJpegDimensions(buffer);
    case 'image/png':
      return getPngDimensions(buffer);
    case 'image/webp':
      return getWebpDimensions(buffer);
    default:
      return null; // Não sabemos extrair dimensões deste formato
  }
}

/**
 * Valida a qualidade de uma imagem antes de enviar para OCR
 * @param {Buffer} buffer - Buffer da imagem
 * @param {string} mimeType - Tipo MIME da imagem
 * @returns {{ valid: boolean, error?: string, warning?: string, dimensions?: { width: number, height: number } }}
 */
function validateImage(buffer, mimeType) {
  const result = {
    valid: true,
    warnings: []
  };

  // 1. Verifica se buffer existe
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Imagem vazia ou corrompida' };
  }

  // 2. Verifica tamanho mínimo
  if (buffer.length < LIMITS.MIN_FILE_SIZE_BYTES) {
    return { 
      valid: false, 
      error: `Imagem muito pequena (${Math.round(buffer.length / 1024)}KB). Envie uma imagem de melhor qualidade.` 
    };
  }

  // 3. Verifica tamanho máximo
  if (buffer.length > LIMITS.MAX_FILE_SIZE_BYTES) {
    return { 
      valid: false, 
      error: `Imagem muito grande (${Math.round(buffer.length / 1024 / 1024)}MB). Limite é ${Math.round(LIMITS.MAX_FILE_SIZE_BYTES / 1024 / 1024)}MB.` 
    };
  }

  // 4. Verifica tipo MIME
  if (!LIMITS.VALID_MIME_TYPES.includes(mimeType)) {
    return { 
      valid: false, 
      error: `Formato não suportado (${mimeType}). Envie JPEG, PNG, WebP ou PDF.` 
    };
  }

  // 5. Para PDFs, não verificamos dimensões
  if (mimeType === 'application/pdf') {
    return { valid: true };
  }

  // 6. Tenta extrair dimensões
  const dimensions = getImageDimensions(buffer, mimeType);
  
  if (dimensions) {
    result.dimensions = dimensions;

    // Verifica dimensões mínimas
    if (dimensions.width < LIMITS.MIN_DIMENSION || dimensions.height < LIMITS.MIN_DIMENSION) {
      return { 
        valid: false, 
        error: `Imagem muito pequena (${dimensions.width}x${dimensions.height}). Mínimo recomendado: ${LIMITS.MIN_DIMENSION}x${LIMITS.MIN_DIMENSION} pixels.`,
        dimensions
      };
    }

    // Verifica dimensões máximas
    if (dimensions.width > LIMITS.MAX_DIMENSION || dimensions.height > LIMITS.MAX_DIMENSION) {
      result.warnings.push(`Imagem muito grande (${dimensions.width}x${dimensions.height}). Pode demorar para processar.`);
    }

    // Verifica aspect ratio (evita imagens muito deformadas)
    const aspectRatio = dimensions.width / dimensions.height;
    if (aspectRatio < LIMITS.MIN_ASPECT_RATIO || aspectRatio > LIMITS.MAX_ASPECT_RATIO) {
      result.warnings.push('Proporção da imagem muito extrema. O OCR pode ter dificuldade.');
    }

    // Verifica se a resolução é muito baixa para OCR de texto
    const megapixels = (dimensions.width * dimensions.height) / 1000000;
    if (megapixels < 0.05) { // Menos de 50K pixels
      result.warnings.push('Resolução baixa. O texto pode não ser legível.');
    }
  }

  result.warning = result.warnings.length > 0 ? result.warnings.join(' ') : undefined;
  delete result.warnings;

  return result;
}

/**
 * Estima se a imagem é provavelmente uma foto de documento
 * (versus uma foto qualquer) baseado em heurísticas simples
 * @param {Buffer} buffer 
 * @param {string} mimeType 
 * @returns {boolean}
 */
function likelyDocument(buffer, mimeType) {
  // PDFs são sempre documentos
  if (mimeType === 'application/pdf') return true;

  const dimensions = getImageDimensions(buffer, mimeType);
  if (!dimensions) return true; // Se não sabemos, assume que pode ser

  const { width, height } = dimensions;
  const aspectRatio = width / height;

  // Documentos geralmente têm aspect ratio próximo de A4 (1.414) ou carta (1.294)
  // ou são quadrados (screenshots, recibos)
  const isDocumentAspectRatio = 
    (aspectRatio >= 0.5 && aspectRatio <= 2.0) || // Orientação portrait ou landscape
    (aspectRatio >= 0.9 && aspectRatio <= 1.1);   // Quadrado

  return isDocumentAspectRatio;
}

module.exports = {
  validateImage,
  getImageDimensions,
  likelyDocument,
  LIMITS
};
