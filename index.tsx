/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from '@google/genai';

// --- TYPES AND STATE ---

interface CopyOption {
  headline: string;
  body: string;
}

interface Creative {
  id: string;
  baseImageUrlWithLogo: string;
  finalImageUrl: string;
  headline: string;
  body: string;
  ctaText?: string;
  prompt: string;
  rating: number; // 0-5
}

interface GeneratedCreative {
  baseImageUrlWithLogo: string;
  compositeImageUrls: string[]; // with text
  copyOptions: CopyOption[];
  imagePrompt: string;
  campaignDescription: string;
  ctaText?: string;
  selectedIndex: number;
}

interface SavedImage {
  id: string;
  url: string;
  prompt: string;
}

interface AppState {
  isLoading: boolean;
  isCopyLoading: boolean;
  generatedCreative: GeneratedCreative | null;
  savedCreatives: Creative[];
  error: string | null;
  fileName: string | null;
  logoFile: File | null;

  // App structure
  activeTab: 'creative' | 'image';

  // Form state for persistence
  campaignDescription: string;
  imagePrompt: string;
  format: '1:1' | '9:16' | '16:9';
  logoPosition: 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left';
  ctaText: string;
  // Editing state
  editingCreative: Creative | null;

  // Image Generator State
  isImageLoading: boolean;
  imageError: string | null;
  generatedImageUrl: string | null;
  imageGenPrompt: string;
  imageGenStyle: 'Fotorealista' | 'Estúdio' | 'Cinematográfico' | 'Preto e Branco' | 'Fantasia';
  imageGenFormat: '1:1' | '9:16' | '16:9';
  savedImages: SavedImage[];

  // Creative Gen form state
  imageSource: 'generate' | 'saved';
  selectedSavedImageId: string | null;
}

// --- LOCAL STORAGE HELPERS ---

function getSavedCreativesFromStorage(): Creative[] {
    try {
        const storedCreatives = localStorage.getItem('savedCreatives');
        return storedCreatives ? JSON.parse(storedCreatives) : [];
    } catch (e) {
        console.error("Failed to parse saved creatives from localStorage", e);
        return [];
    }
}

function saveCreativesToStorage(creatives: Creative[]) {
    try {
        localStorage.setItem('savedCreatives', JSON.stringify(creatives));
    } catch (e) {
        console.error("Failed to save creatives to localStorage", e);
    }
}

function getSavedImagesFromStorage(): SavedImage[] {
    try {
        const storedImages = localStorage.getItem('savedImages');
        return storedImages ? JSON.parse(storedImages) : [];
    } catch (e) {
        console.error("Failed to parse saved images from localStorage", e);
        return [];
    }
}

function saveImagesToStorage(images: SavedImage[]) {
    try {
        localStorage.setItem('savedImages', JSON.stringify(images));
    } catch (e) {
        console.error("Failed to save images to localStorage", e);
    }
}


const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

let state: AppState = {
  isLoading: false,
  isCopyLoading: false,
  generatedCreative: null,
  savedCreatives: getSavedCreativesFromStorage(),
  error: null,
  fileName: null,
  logoFile: null,
  activeTab: 'creative',
  campaignDescription: '',
  imagePrompt: '',
  format: '1:1',
  logoPosition: 'bottom-right',
  ctaText: '',
  editingCreative: null,
  isImageLoading: false,
  imageError: null,
  generatedImageUrl: null,
  imageGenPrompt: '',
  imageGenStyle: 'Fotorealista',
  imageGenFormat: '1:1',
  savedImages: getSavedImagesFromStorage(),
  imageSource: 'generate',
  selectedSavedImageId: null,
};

// --- STATE MANAGEMENT ---

function setState(newState: Partial<AppState>) {
  state = { ...state, ...newState };

  // Persistence logic
  if (newState.savedCreatives !== undefined) {
      saveCreativesToStorage(state.savedCreatives);
  }
  if (newState.savedImages !== undefined) {
      saveImagesToStorage(state.savedImages);
  }

  renderApp();
}

// --- API & CANVAS HELPERS ---

/**
 * Converts a File object to a base64 string, stripping the data URL prefix.
 */
function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            // A API espera apenas a string base64, sem o prefixo 'data:image/...;base64,'
            resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}


/**
 * Calculates the required height for a given text when wrapped to a max width.
 * @returns An object containing the lines of text and the total height.
 */
function calculateWrappedTextHeight(context: CanvasRenderingContext2D, text: string, maxWidth: number, lineHeight: number): { lines: string[], height: number } {
    if (!text || text.trim() === '') {
        return { lines: [], height: 0 };
    }
    
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
        const testLine = currentLine.length > 0 ? `${currentLine} ${word}` : word;
        const metrics = context.measureText(testLine);
        
        if (metrics.width > maxWidth && currentLine.length > 0) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    }
    lines.push(currentLine);

    return { lines, height: lines.length * lineHeight };
}

/**
 * Draws pre-calculated wrapped text lines onto the canvas.
 */
function drawWrappedText(context: CanvasRenderingContext2D, lines: string[], x: number, y: number, lineHeight: number) {
    let currentY = y;
    for (const line of lines) {
        context.fillText(line, x, currentY);
        currentY += lineHeight;
    }
}


async function renderTextOnImage(baseImageUrl: string, headline: string, body: string, ctaText?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject('Não foi possível obter o contexto do canvas.');

        const baseImage = new Image();
        baseImage.crossOrigin = "anonymous";
        baseImage.onload = () => {
            canvas.width = baseImage.width;
            canvas.height = baseImage.height;
            ctx.drawImage(baseImage, 0, 0);

            // --- Style Calculations ---
            const padding = canvas.width * 0.06;
            const contentWidth = canvas.width - (padding * 2);
            const headlineFontSize = Math.max(24, Math.floor(canvas.width / 20));
            const headlineLineHeight = headlineFontSize * 1.3;
            const bodyFontSize = Math.max(16, Math.floor(canvas.width / 30));
            const bodyLineHeight = bodyFontSize * 1.4;
            const spacing = bodyFontSize * 1.2;

            // --- Content Height Calculation (Dry Run) ---
            let totalContentHeight = 0;

            // 1. Headline
            ctx.font = `700 ${headlineFontSize}px Inter, sans-serif`;
            const headlineMetrics = calculateWrappedTextHeight(ctx, headline, contentWidth, headlineLineHeight);
            totalContentHeight += headlineMetrics.height;
            
            // 2. Body
            ctx.font = `400 ${bodyFontSize}px Inter, sans-serif`;
            const bodyMetrics = calculateWrappedTextHeight(ctx, body, contentWidth, bodyLineHeight);
            if (bodyMetrics.height > 0) {
                totalContentHeight += spacing + bodyMetrics.height;
            }
            
            // 3. CTA Button
            let ctaBlockHeight = 0;
            if (ctaText && ctaText.trim().length > 0) {
                const ctaFontSize = bodyFontSize * 1.1;
                ctaBlockHeight = ctaFontSize * 2.4; // height of button
                totalContentHeight += padding + ctaBlockHeight;
            }
            
            // --- Draw Background ---
            const rectHeight = totalContentHeight + (padding * 2);
            const rectY = canvas.height - rectHeight;
            const safeRectY = Math.max(0, rectY); // Prevent going off the top of the canvas
            const safeRectHeight = canvas.height - safeRectY; // Ensure rect goes to the bottom
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
            ctx.fillRect(0, safeRectY, canvas.width, safeRectHeight);
            
            // --- Draw Content ---
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top'; // Set baseline to top for easier line-by-line rendering
            let currentY = safeRectY + padding;

            // 1. Draw Headline
            ctx.fillStyle = 'white';
            ctx.font = `700 ${headlineFontSize}px Inter, sans-serif`;
            drawWrappedText(ctx, headlineMetrics.lines, canvas.width / 2, currentY, headlineLineHeight);
            currentY += headlineMetrics.height;

            // 2. Draw Body
            if (bodyMetrics.height > 0) {
                currentY += spacing;
                ctx.font = `400 ${bodyFontSize}px Inter, sans-serif`;
                drawWrappedText(ctx, bodyMetrics.lines, canvas.width / 2, currentY, bodyLineHeight);
                currentY += bodyMetrics.height;
            }

            // 3. Draw CTA Button
            if (ctaBlockHeight > 0) {
                currentY += padding;
                // Safety check to ensure button is visible
                if (currentY + ctaBlockHeight > canvas.height) {
                    currentY = canvas.height - ctaBlockHeight - (padding / 2);
                }

                const ctaFontSize = bodyFontSize * 1.1;
                ctx.font = `700 ${ctaFontSize}px Inter, sans-serif`;
                const ctaMetrics = ctx.measureText(ctaText!);
                const ctaButtonWidth = ctaMetrics.width + (padding * 2);
                const ctaButtonX = (canvas.width - ctaButtonWidth) / 2;
                
                ctx.fillStyle = '#bb86fc';
                ctx.fillRect(ctaButtonX, currentY, ctaButtonWidth, ctaBlockHeight);

                ctx.fillStyle = '#121212';
                ctx.textBaseline = 'middle';
                ctx.fillText(ctaText!, canvas.width / 2, currentY + ctaBlockHeight / 2);
            }
            
            resolve(canvas.toDataURL('image/jpeg', 0.9));
        };
        baseImage.onerror = reject;
        baseImage.src = baseImageUrl;
    });
}


async function compositeImageWithLogo(baseImageUrl: string, logoFile: File, position: AppState['logoPosition']): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return reject('Não foi possível obter o contexto do canvas.');

    const baseImage = new Image();
    baseImage.crossOrigin = "anonymous";
    baseImage.onload = () => {
      canvas.width = baseImage.width;
      canvas.height = baseImage.height;
      ctx.drawImage(baseImage, 0, 0);

      const logoImage = new Image();
      const logoUrl = URL.createObjectURL(logoFile);

      logoImage.onload = () => {
        const padding = canvas.width * 0.05;
        const logoWidth = canvas.width * 0.2; // 20% da largura
        const scale = logoWidth / logoImage.width;
        const logoHeight = logoImage.height * scale;
        
        let x, y;
        
        switch (position) {
            case 'top-left':
                x = padding;
                y = padding;
                break;
            case 'top-right':
                x = canvas.width - logoWidth - padding;
                y = padding;
                break;
            case 'bottom-left':
                x = padding;
                y = canvas.height - logoHeight - padding;
                break;
            case 'bottom-right':
            default:
                x = canvas.width - logoWidth - padding;
                y = canvas.height - logoHeight - padding;
                break;
        }


        ctx.globalAlpha = 0.9; // Leve transparência
        ctx.drawImage(logoImage, x, y, logoWidth, logoHeight);
        ctx.globalAlpha = 1.0;
        URL.revokeObjectURL(logoUrl); // IMPORTANT: Release memory
        resolve(canvas.toDataURL('image/jpeg', 0.9)); // Use lower quality
      };
      logoImage.onerror = (err) => {
          URL.revokeObjectURL(logoUrl); // Also release on error
          reject(err);
      };
      logoImage.src = logoUrl;
    };
    baseImage.onerror = reject;
    baseImage.src = baseImageUrl;
  });
}

// --- EVENT HANDLERS ---
function syncFormState(event: Event) {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    const { name, value } = target;
    // Only update the state object, don't trigger a full re-render.
    // This prevents the input from losing focus while typing.
    state = { ...state, [name]: value };
}

function handleTabClick(tab: AppState['activeTab']) {
    setState({ activeTab: tab });
}

function handleImageSourceChange(source: AppState['imageSource']) {
    setState({ imageSource: source });
}

function handleSelectSavedImage(imageId: string) {
    setState({ selectedSavedImageId: imageId });
}

async function handleGenerate(event: Event) {
  event.preventDefault();

  const { campaignDescription, imagePrompt, format, ctaText, logoFile, logoPosition, imageSource, selectedSavedImageId, savedImages } = state;

  const isUsingSavedImage = imageSource === 'saved';
  if (!campaignDescription || (!isUsingSavedImage && !imagePrompt) || (isUsingSavedImage && !selectedSavedImageId)) {
    setState({ error: 'Por favor, preencha todos os campos obrigatórios.' });
    return;
  }

  setState({ isLoading: true, generatedCreative: null, error: null });

  try {
    const copyGenerationPromise = ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [{
            text: `Você é um copywriter de resposta direta, especialista em criar anúncios de alta conversão. Sua tarefa é criar 3 opções de copy (título e corpo) para um anúncio, com base na descrição da campanha.
            REGRAS IMPORTANTES:
            1. Seja breve e impactante. Use frases curtas e diretas.
            2. Foque em um único benefício principal.
            3. Use gatilhos mentais (ex: urgência, prova social, novidade) quando apropriado.
            4. O título deve ter no máximo 6 palavras. O corpo do texto, no máximo 20 palavras.

            Descrição da Campanha: ${campaignDescription}`
          }]
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              copyOptions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    headline: { type: Type.STRING },
                    body: { type: Type.STRING },
                  },
                  required: ['headline', 'body'],
                },
              },
            },
            required: ['copyOptions'],
          },
        },
      });

      let imagePromise: Promise<string>;
      let finalImagePrompt = imagePrompt;

      if (isUsingSavedImage) {
          const selectedImage = savedImages.find(img => img.id === selectedSavedImageId);
          if (!selectedImage) throw new Error("Imagem salva não encontrada.");
          finalImagePrompt = selectedImage.prompt;
          imagePromise = Promise.resolve(selectedImage.url);
      } else {
          imagePromise = ai.models.generateImages({
              model: 'imagen-4.0-generate-001',
              prompt: imagePrompt,
              config: {
                numberOfImages: 1,
                aspectRatio: format,
                outputMimeType: 'image/jpeg',
              },
          }).then(response => `data:image/jpeg;base64,${response.generatedImages[0].image.imageBytes}`);
      }

    const [copyResponse, baseImageUrl] = await Promise.all([
        copyGenerationPromise,
        imagePromise
    ]);
      
    let imageUrl = baseImageUrl;

    const parsedCopyResponse = JSON.parse(copyResponse.text);

    if (logoFile) {
        imageUrl = await compositeImageWithLogo(imageUrl, logoFile, logoPosition);
    }

    const compositeImagePromises = parsedCopyResponse.copyOptions.map((option: CopyOption) => 
        renderTextOnImage(imageUrl, option.headline, option.body, ctaText)
    );
    const compositeImageUrls = await Promise.all(compositeImagePromises);

    setState({
      isLoading: false,
      generatedCreative: {
        copyOptions: parsedCopyResponse.copyOptions,
        baseImageUrlWithLogo: imageUrl,
        compositeImageUrls,
        selectedIndex: 0,
        imagePrompt: finalImagePrompt,
        campaignDescription: campaignDescription,
        ctaText: ctaText,
      },
    });
  } catch (err) {
    console.error(err);
    setState({
      isLoading: false,
      error: 'Ocorreu um erro ao gerar o criativo. Em dispositivos móveis, isso pode ser causado por limitações de memória. Tente novamente.',
    });
  }
}

async function handleGenerateImage(event: Event) {
    event.preventDefault();
    const { imageGenPrompt, imageGenStyle, imageGenFormat } = state;

    if(!imageGenPrompt) {
        setState({ imageError: 'Por favor, descreva a imagem.' });
        return;
    }

    setState({ isImageLoading: true, generatedImageUrl: null, imageError: null });

    try {
        const finalPrompt = `Fotografia no estilo ${imageGenStyle} de: ${imageGenPrompt}. Foco no realismo.`;
        const aspectRatio = imageGenFormat;

        const imageResponse = await ai.models.generateImages({
            model: 'imagen-4.0-generate-001',
            prompt: finalPrompt,
            config: {
                numberOfImages: 1,
                aspectRatio: aspectRatio,
                outputMimeType: 'image/jpeg',
            },
        });

        const base64Image = imageResponse.generatedImages[0].image.imageBytes;
        const imageUrl = `data:image/jpeg;base64,${base64Image}`;

        setState({
            isImageLoading: false,
            generatedImageUrl: imageUrl
        });

    } catch (err) {
        console.error(err);
        setState({
            isImageLoading: false,
            imageError: 'Não foi possível gerar a imagem. Em dispositivos móveis, isso pode ser causado por limitações de memória. Tente novamente.'
        });
    }
}

function handleSaveGeneratedImage() {
    if (!state.generatedImageUrl || !state.imageGenPrompt) return;

    if (state.savedImages.some(img => img.url === state.generatedImageUrl)) {
        return;
    }

    const newSavedImage: SavedImage = {
        id: `savedimg-${Date.now()}`,
        url: state.generatedImageUrl,
        prompt: state.imageGenPrompt,
    };

    setState({
        savedImages: [...state.savedImages, newSavedImage]
    });
}

function handleDeleteSavedImage(imageId: string) {
    setState({
        savedImages: state.savedImages.filter(img => img.id !== imageId)
    });
}


async function handleRegenerateCopy() {
    if (!state.generatedCreative) return;

    setState({ isCopyLoading: true, error: null });
    
    try {
        const { campaignDescription, baseImageUrlWithLogo, ctaText } = state.generatedCreative;

        const copyResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: {
              parts: [{
                text: `Você é um copywriter de resposta direta, especialista em criar anúncios de alta conversão. Sua tarefa é criar 3 opções de copy (título e corpo) para um anúncio, com base na descrição da campanha.
                REGRAS IMPORTANTES:
                1. Seja breve e impactante. Use frases curtas e diretas.
                2. Foque em um único benefício principal.
                3. Use gatilhos mentais (ex: urgência, prova social, novidade) quando apropriado.
                4. O título deve ter no máximo 6 palavras. O corpo do texto, no máximo 20 palavras.
    
                Descrição da Campanha: ${campaignDescription}`
              }]
            },
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  copyOptions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        headline: { type: Type.STRING },
                        body: { type: Type.STRING },
                      },
                      required: ['headline', 'body'],
                    },
                  },
                },
                required: ['copyOptions'],
              },
            },
        });

        const parsedCopyResponse = JSON.parse(copyResponse.text);

        const compositeImagePromises = parsedCopyResponse.copyOptions.map((option: CopyOption) => 
            renderTextOnImage(baseImageUrlWithLogo, option.headline, option.body, ctaText)
        );
        const newCompositeImageUrls = await Promise.all(compositeImagePromises);

        setState({
            isCopyLoading: false,
            generatedCreative: {
                ...state.generatedCreative,
                copyOptions: parsedCopyResponse.copyOptions,
                compositeImageUrls: newCompositeImageUrls,
                selectedIndex: 0,
            }
        });

    } catch (err) {
        console.error("Error regenerating copy:", err);
        setState({
            isCopyLoading: false,
            error: "Não foi possível gerar uma nova copy. Tente novamente."
        });
    }
}


function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) {
    setState({
      logoFile: file,
      fileName: file.name,
    });
  }
}

function handleSelectCopy(index: number) {
  if (state.generatedCreative) {
    setState({
      generatedCreative: {
        ...state.generatedCreative,
        selectedIndex: index,
      },
    });
  }
}

function handleSaveCreative() {
    if (!state.generatedCreative) return;
    const { selectedIndex, compositeImageUrls, copyOptions, baseImageUrlWithLogo, imagePrompt, ctaText } = state.generatedCreative;

    const newCreative: Creative = {
        id: `creative-${Date.now()}`,
        baseImageUrlWithLogo: baseImageUrlWithLogo,
        finalImageUrl: compositeImageUrls[selectedIndex],
        headline: copyOptions[selectedIndex].headline,
        body: copyOptions[selectedIndex].body,
        ctaText: ctaText,
        prompt: imagePrompt,
        rating: 0,
    };

    setState({
        savedCreatives: [...state.savedCreatives, newCreative],
        generatedCreative: null, // Clear the generated creative after saving
    });
}

function handleDeleteCreative(id: string) {
    if (confirm('Tem certeza que deseja excluir este criativo?')) {
        setState({
            savedCreatives: state.savedCreatives.filter(c => c.id !== id),
        });
    }
}

function handleSetRating(id: string, rating: number) {
    setState({
        savedCreatives: state.savedCreatives.map(c => 
            c.id === id ? { ...c, rating } : c
        ),
    });
}

function handleDownload(imageUrl: string) {
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `creative-${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function handleEditCreative(creative: Creative) {
    setState({ editingCreative: creative });
}

function handleCloseModal() {
    setState({ editingCreative: null });
}

async function handleUpdateCreative(event: Event) {
    event.preventDefault();
    if (!state.editingCreative) return;

    setState({ isLoading: true }); // Use main loader for modal updates

    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const updatedHeadline = formData.get('headline') as string;
    const updatedBody = formData.get('body') as string;
    const updatedCta = formData.get('ctaText') as string;

    try {
        const newFinalImageUrl = await renderTextOnImage(
            state.editingCreative.baseImageUrlWithLogo,
            updatedHeadline,
            updatedBody,
            updatedCta
        );

        setState({
            savedCreatives: state.savedCreatives.map(c => 
                c.id === state.editingCreative!.id 
                ? { 
                    ...c, 
                    headline: updatedHeadline, 
                    body: updatedBody,
                    ctaText: updatedCta,
                    finalImageUrl: newFinalImageUrl 
                } 
                : c
            ),
            editingCreative: null, // Close modal
            isLoading: false
        });

    } catch (err) {
        console.error("Error updating creative:", err);
        setState({
            isLoading: false,
            error: "Falha ao atualizar o criativo." // Could show this in the modal too
        });
    }
}


// --- RENDER FUNCTIONS ---

function renderApp() {
  const appEl = document.getElementById('app');
  if (!appEl) return;

  appEl.innerHTML = `
    <header>
      <h1>ADS PENGUIN 🐧</h1>
      <p>Crie anúncios de alta performance com o poder da IA.</p>
    </header>
    
    <div class="tabs-container">
        <button id="creative-tab-btn" class="tab-btn ${state.activeTab === 'creative' ? 'active' : ''}">Gerador de Criativos</button>
        <button id="image-tab-btn" class="tab-btn ${state.activeTab === 'image' ? 'active' : ''}">Gerador de Imagens</button>
    </div>

    <main>
      ${state.activeTab === 'creative' ? renderCreativeGeneratorTab() : renderImageGeneratorTab()}
    </main>

    ${state.editingCreative ? renderEditModal() : ''}
  `;

  // Add event listeners after render
  document.getElementById('creative-tab-btn')?.addEventListener('click', () => handleTabClick('creative'));
  document.getElementById('image-tab-btn')?.addEventListener('click', () => handleTabClick('image'));

  if (state.activeTab === 'creative') {
    document.getElementById('generator-form')?.addEventListener('submit', handleGenerate);
    document.getElementById('generator-form')?.querySelectorAll('input, textarea, select').forEach(el => {
        el.addEventListener('change', syncFormState);
    });
    document.getElementById('logo')?.addEventListener('change', handleFileChange);
    document.querySelectorAll('.thumbnail').forEach((thumb, index) => {
        thumb.addEventListener('click', () => handleSelectCopy(index));
    });
    document.getElementById('save-creative-btn')?.addEventListener('click', handleSaveCreative);
    document.getElementById('regenerate-copy-btn')?.addEventListener('click', handleRegenerateCopy);
    document.getElementById('download-btn')?.addEventListener('click', () => handleDownload(state.generatedCreative!.compositeImageUrls[state.generatedCreative!.selectedIndex]));
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', () => handleDeleteCreative(btn.getAttribute('data-id')!));
    });
    document.querySelectorAll('.edit-btn').forEach(btn => {
        const creativeId = btn.getAttribute('data-id')!;
        const creativeToEdit = state.savedCreatives.find(c => c.id === creativeId);
        if (creativeToEdit) {
            btn.addEventListener('click', () => handleEditCreative(creativeToEdit));
        }
    });
     document.querySelectorAll('.download-saved-btn').forEach(btn => {
        btn.addEventListener('click', () => handleDownload(btn.getAttribute('data-url')!));
    });
    document.querySelectorAll('.star-rating').forEach(ratingEl => {
        const id = ratingEl.getAttribute('data-id')!;
        ratingEl.querySelectorAll('.star').forEach(star => {
            star.addEventListener('click', () => {
                handleSetRating(id, parseInt(star.getAttribute('data-value')!));
            });
        });
    });
    // Image source listeners
    document.getElementById('source-generate-btn')?.addEventListener('click', () => handleImageSourceChange('generate'));
    document.getElementById('source-saved-btn')?.addEventListener('click', () => handleImageSourceChange('saved'));
    document.querySelectorAll('.picker-image').forEach(img => {
        img.addEventListener('click', () => handleSelectSavedImage(img.getAttribute('data-id')!));
    });


  } else {
    document.getElementById('image-generator-form')?.addEventListener('submit', handleGenerateImage);
    document.getElementById('image-generator-form')?.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('change', syncFormState);
    });
    document.getElementById('save-generated-image-btn')?.addEventListener('click', handleSaveGeneratedImage);
    document.querySelectorAll('.delete-saved-image-btn').forEach(btn => {
        btn.addEventListener('click', () => handleDeleteSavedImage(btn.getAttribute('data-id')!));
    });
  }

  // Modal Listeners
  if(state.editingCreative) {
    document.getElementById('close-modal-btn')?.addEventListener('click', handleCloseModal);
    document.getElementById('cancel-edit-btn')?.addEventListener('click', handleCloseModal);
    document.querySelector('.modal-overlay')?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) handleCloseModal();
    });
    document.getElementById('edit-creative-form')?.addEventListener('submit', handleUpdateCreative);
  }
}

function renderCreativeGeneratorTab() {
  return `
    <div class="card">
      <h2>1. Descreva sua Campanha</h2>
      <form id="generator-form">
        <div class="form-group">
          <label for="campaignDescription">Descrição da Campanha</label>
          <textarea id="campaignDescription" name="campaignDescription" placeholder="Ex: Venda de sapatos de couro artesanais, focados em conforto e durabilidade. Público-alvo: homens 30-50 anos." required>${state.campaignDescription}</textarea>
        </div>
        
        <div class="form-group">
            <label>Fonte da Imagem</label>
            <div class="image-source-selector">
                <button type="button" id="source-generate-btn" class="source-btn ${state.imageSource === 'generate' ? 'active' : ''}" ${state.isLoading ? 'disabled' : ''}>Gerar Nova Imagem</button>
                <button type="button" id="source-saved-btn" class="source-btn ${state.imageSource === 'saved' ? 'active' : ''}" ${state.savedImages.length === 0 ? 'disabled' : ''} ${state.isLoading ? 'disabled' : ''}>Usar Imagem Salva</button>
            </div>
            ${state.savedImages.length === 0 ? '<small style="margin-top: 4px; display: block;">Você ainda não salvou nenhuma imagem. Use a aba "Gerador de Imagens".</small>' : ''}
        </div>

        ${state.imageSource === 'generate' ? `
            <div class="form-group">
                <label for="imagePrompt">Descrição da Imagem</label>
                <textarea id="imagePrompt" name="imagePrompt" placeholder="Ex: Um homem de negócios elegante amarrando os sapatos de couro em um escritório moderno." required>${state.imagePrompt}</textarea>
            </div>
            <div class="form-group">
                <label for="format">Formato da Imagem</label>
                <select id="format" name="format" required>
                    <option value="1:1" ${state.format === '1:1' ? 'selected' : ''}>Quadrado (1:1)</option>
                    <option value="9:16" ${state.format === '9:16' ? 'selected' : ''}>Stories/Reels (9:16)</option>
                    <option value="16:9" ${state.format === '16:9' ? 'selected' : ''}>Paisagem (16:9)</option>
                </select>
            </div>
        ` : `
            <div class="form-group">
                <label>Selecione uma Imagem Salva</label>
                ${state.savedImages.length > 0 ? `
                    <div class="saved-image-picker">
                        ${state.savedImages.map(img => `
                            <img src="${img.url}" 
                                 alt="${img.prompt}" 
                                 title="${img.prompt}"
                                 class="picker-image ${state.selectedSavedImageId === img.id ? 'selected' : ''}" 
                                 data-id="${img.id}">
                        `).join('')}
                    </div>
                ` : `<p>Nenhuma imagem salva encontrada.</p>`}
            </div>
        `}
        
        <h2>2. Adicione seu Logo (Opcional)</h2>
        <div class="form-grid-container">
            <div class="form-group">
                <label for="logo">Arquivo do Logo (.png, .jpg)</label>
                <div class="file-input-wrapper">
                    <input type="file" id="logo" name="logo" accept="image/png, image/jpeg">
                    <span class="file-input-label">${state.fileName || "Clique para selecionar um arquivo"}</span>
                </div>
            </div>
            <div class="form-group">
                <label for="logoPosition">Posição do Logo</label>
                <select id="logoPosition" name="logoPosition">
                    <option value="bottom-right" ${state.logoPosition === 'bottom-right' ? 'selected' : ''}>Canto Inferior Direito</option>
                    <option value="bottom-left" ${state.logoPosition === 'bottom-left' ? 'selected' : ''}>Canto Inferior Esquerdo</option>
                    <option value="top-right" ${state.logoPosition === 'top-right' ? 'selected' : ''}>Canto Superior Direito</option>
                    <option value="top-left" ${state.logoPosition === 'top-left' ? 'selected' : ''}>Canto Superior Esquerdo</option>
                </select>
            </div>
        </div>

        <h2>3. Call-to-Action (Opcional)</h2>
        <div class="form-group">
            <label for="ctaText">Texto do Botão (Ex: Compre Agora)</label>
            <input type="text" id="ctaText" name="ctaText" value="${state.ctaText}" placeholder="Deixe em branco para não ter botão">
        </div>

        <button type="submit" ${state.isLoading ? 'disabled' : ''}>
          ${state.isLoading ? '<span class="loader copy-loader"></span> Gerando...' : 'Gerar Criativo Mágico'}
        </button>
      </form>
    </div>

    <div id="results-section" class="card">
        ${renderResults()}
    </div>
    
    <div id="saved-creatives-section" class="card">
        <h2>Criativos Salvos</h2>
        ${renderSavedCreatives()}
    </div>
  `;
}

function renderImageGeneratorTab() {
  return `
    <div class="card">
      <h2>Gerador de Imagens</h2>
      <p>Crie imagens únicas para seus anúncios ou como base para seus criativos.</p>
      <form id="image-generator-form">
        <div class="form-group">
          <label for="imageGenPrompt">1. Descreva a Imagem que Você Quer Criar</label>
          <textarea id="imageGenPrompt" name="imageGenPrompt" placeholder="Ex: Um astronauta surfando em uma onda cósmica com planetas ao fundo." required>${state.imageGenPrompt}</textarea>
        </div>
        <div class="form-grid-container">
            <div class="form-group">
              <label for="imageGenStyle">2. Estilo Visual</label>
              <select id="imageGenStyle" name="imageGenStyle">
                <option value="Fotorealista" ${state.imageGenStyle === 'Fotorealista' ? 'selected' : ''}>Fotorealista</option>
                <option value="Estúdio" ${state.imageGenStyle === 'Estúdio' ? 'selected' : ''}>Estúdio</option>
                <option value="Cinematográfico" ${state.imageGenStyle === 'Cinematográfico' ? 'selected' : ''}>Cinematográfico</option>
                <option value="Preto e Branco" ${state.imageGenStyle === 'Preto e Branco' ? 'selected' : ''}>Preto e Branco</option>
                <option value="Fantasia" ${state.imageGenStyle === 'Fantasia' ? 'selected' : ''}>Fantasia</option>
              </select>
            </div>
            <div class="form-group">
              <label for="imageGenFormat">3. Formato</label>
              <select id="imageGenFormat" name="imageGenFormat">
                <option value="1:1" ${state.imageGenFormat === '1:1' ? 'selected' : ''}>Quadrado (1:1)</option>
                <option value="9:16" ${state.imageGenFormat === '9:16' ? 'selected' : ''}>Vertical (9:16)</option>
                <option value="16:9" ${state.imageGenFormat === '16:9' ? 'selected' : ''}>Horizontal (16:9)</option>
              </select>
            </div>
        </div>
        <button type="submit" ${state.isImageLoading ? 'disabled' : ''}>
            ${state.isImageLoading ? '<span class="loader copy-loader"></span> Gerando Imagem...' : 'Gerar Imagem'}
        </button>
      </form>
    </div>

    <div id="image-results-section" class="card">
      ${renderImageResults()}
    </div>

    <div id="saved-images-section" class="card">
        <h2>Imagens Salvas</h2>
        ${renderSavedImages()}
    </div>
  `;
}

function renderResults() {
    if (state.isLoading) return '<div class="loader"></div><p>Gerando seu criativo...</p>';
    if (state.error) return `<div class="error-message">${state.error}</div>`;
    if (!state.generatedCreative) return '<h2>Seu criativo aparecerá aqui</h2><p>Preencha o formulário acima para começar.</p>';

    const { selectedIndex, compositeImageUrls, copyOptions } = state.generatedCreative;

    return `
        <div class="generated-content">
            <div class="generated-preview">
                <img src="${compositeImageUrls[selectedIndex]}" alt="Criativo gerado" />
            </div>
            <div class="generated-thumbnails">
                <p><strong>Escolha sua copy favorita:</strong></p>
                <div class="thumbnail-container">
                    ${compositeImageUrls.map((url, index) => `
                        <img 
                            src="${url}" 
                            alt="Opção de copy ${index + 1}" 
                            class="thumbnail ${index === selectedIndex ? 'active' : ''}" 
                            title="${copyOptions[index].headline} - ${copyOptions[index].body}"
                        />
                    `).join('')}
                </div>
            </div>
            <div class="generated-actions">
                <button id="regenerate-copy-btn" class="secondary" ${state.isCopyLoading ? 'disabled' : ''}>
                    ${state.isCopyLoading ? '<span class="loader copy-loader"></span> Regenerando...' : '↻ Regenerar Copy'}
                </button>
                <button id="download-btn">Baixar Criativo</button>
                <button id="save-creative-btn">Salvar Criativo</button>
            </div>
        </div>
    `;
}

function renderImageResults() {
    if (state.isImageLoading) return '<div class="loader"></div><p>Gerando sua imagem...</p>';
    if (state.imageError) return `<div class="error-message">${state.imageError}</div>`;
    if (!state.generatedImageUrl) return '<h2>Sua imagem aparecerá aqui</h2><p>Descreva a imagem que você precisa e clique em "Gerar".</p>';

    const isSaved = state.savedImages.some(img => img.url === state.generatedImageUrl);

    return `
        <div class="generated-content">
            <div class="generated-preview">
                <img src="${state.generatedImageUrl}" alt="Imagem gerada" />
            </div>
            <div class="generated-actions">
                <button id="save-generated-image-btn" ${isSaved ? 'disabled' : ''}>
                    ${isSaved ? '✔ Salvo' : 'Salvar Imagem'}
                </button>
                <button id="download-image-btn" onclick="(${handleDownload})('${state.generatedImageUrl}')">Baixar Imagem</button>
            </div>
        </div>
    `;
}

function renderSavedCreatives() {
    if (state.savedCreatives.length === 0) {
        return '<p>Nenhum criativo salvo ainda.</p>';
    }
    return `
        <div class="grid">
            ${state.savedCreatives.map(c => `
                <div class="saved-item">
                    <img src="${c.finalImageUrl}" alt="Criativo salvo: ${c.headline}">
                    <div class="saved-item-content">
                        <div class="saved-item-copy">
                           <h4>${c.headline}</h4>
                           <p>${c.body}</p>
                           ${c.ctaText ? `<p><strong>CTA:</strong> ${c.ctaText}</p>` : ''}
                        </div>
                        <div class="saved-item-footer">
                             <div class="star-rating" data-id="${c.id}">
                                ${[1,2,3,4,5].map(i => `<span class="star ${c.rating >= i ? 'filled' : ''}" data-value="${i}">★</span>`).join('')}
                            </div>
                            <div class="saved-item-actions">
                                <button class="edit-btn" data-id="${c.id}">✎</button>
                                <button class="download-saved-btn" data-url="${c.finalImageUrl}">⤓</button>
                                <button class="delete-btn secondary" data-id="${c.id}">🗑️</button>
                            </div>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderSavedImages() {
    if (state.savedImages.length === 0) {
        return '<p>Quando você salvar uma imagem, ela aparecerá aqui.</p>';
    }
    return `
        <div class="saved-images-grid">
            ${state.savedImages.map(img => `
                <div class="saved-image-item" title="${img.prompt}">
                    <img src="${img.url}" alt="${img.prompt}">
                    <button class="delete-saved-image-btn" data-id="${img.id}">&times;</button>
                </div>
            `).join('')}
        </div>
    `;
}

function renderEditModal() {
    if (!state.editingCreative) return '';
    const { headline, body, ctaText } = state.editingCreative;
    return `
      <div class="modal-overlay">
        <div class="modal card">
            <div class="modal-header">
                <h2>Editar Criativo</h2>
                <button id="close-modal-btn">&times;</button>
            </div>
            <form id="edit-creative-form">
                <div class="form-group">
                    <label for="edit-headline">Título</label>
                    <input type="text" id="edit-headline" name="headline" value="${headline}" required>
                </div>
                <div class="form-group">
                    <label for="edit-body">Corpo</label>
                    <textarea id="edit-body" name="body" required>${body}</textarea>
                </div>
                <div class="form-group">
                    <label for="edit-ctaText">Texto do Botão (CTA)</label>
                    <input type="text" id="edit-ctaText" name="ctaText" value="${ctaText || ''}">
                </div>
                <div class="modal-footer">
                     <button id="cancel-edit-btn" type="button" class="secondary">Cancelar</button>
                     <button type="submit" ${state.isLoading ? 'disabled' : ''}>
                        ${state.isLoading ? '<span class="loader copy-loader"></span> ' : ''}
                        Salvar Alterações
                     </button>
                </div>
            </form>
        </div>
      </div>
    `;
}


// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', renderApp);
