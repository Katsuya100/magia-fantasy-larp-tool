(function registerMagiaCircleDiagnosticView(global) {
  'use strict';

  // Diagnostic DOM and downloads are optional and independent of analysis jobs.
  function create(session) {
    const diagnosticsEnabled = session.enabled;
    const { diagnosticStageState, onnxRuntimeDiagnostics, currentEnvironment } = session;
    const DIAGNOSTIC_TRACE_LIMIT = global.MagiaAnalysisDiagnostics.TRACE_LIMIT;
    const diagnostics = diagnosticsEnabled
      ? { image: null, spell: null, circle: null, attribute: null, sigil: null, power: null }
      : null;

    function publishDiagnostics() {
      if (!diagnostics) return;
      let output = document.getElementById('analysisDiagnostics');
      if (!output) {
        output = document.createElement('pre');
        output.id = 'analysisDiagnostics';
        output.setAttribute('aria-label', '画像解析診断JSON');
        output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:50vh;overflow:auto;padding:1rem;background:#fff;color:#111';
        const download = document.createElement('button');
        download.type = 'button';
        download.textContent = '解析結果JSONを保存';
        download.addEventListener('click', () => {
          const blob = new Blob([JSON.stringify({
            image: diagnostics.image,
            spell: diagnostics.spell,
            circle: diagnostics.circle,
            attribute: diagnostics.attribute,
            sigil: diagnostics.sigil,
            power: diagnostics.power,
            onnxRuntime: onnxRuntimeDiagnostics,
            analysisDiagnostics: createDiagnosticExport(),
          }, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'browser-image-output.json';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 0);
        });
        document.body.append(download, output);
      }
      const pathSummary = path => path && ({ x: path.x, y: path.y, radius: path.r, radii: path.radii, coverage: path.coverage, circleAccuracy: path.circleAccuracy });
      const spell = diagnostics.spell && {
        text: diagnostics.spell.text,
        rawText: diagnostics.spell.rawText,
        words: diagnostics.spell.words,
        corrections: diagnostics.spell.corrections,
        points: diagnostics.spell.points,
        lines: diagnostics.spell.lines,
        rawCandidates: diagnostics.spell.rawCandidates.map(candidate => ({ line: candidate.line, text: candidate.text, votes: candidate.votes })),
        candidates: diagnostics.spell.candidates.map(candidate => ({ text: candidate.text, x: candidate.x, y: candidate.y, groupId: candidate.groupId, confidence: candidate.confidence })),
      };
      const circle = diagnostics.circle && {
        outer: pathSummary(diagnostics.circle.paths?.outer),
        inner: pathSummary(diagnostics.circle.paths?.inner),
        circleAccuracy: diagnostics.circle.paths?.circleAccuracy ?? 0,
        lineStraightness: diagnostics.circle.lineStraightness,
        ringCoverage: diagnostics.circle.ringCoverage,
        sigilScores: diagnostics.circle.sigilScores,
      };
      output.textContent = JSON.stringify({
        image: diagnostics.image,
        spell,
        circle,
        attribute: diagnostics.attribute,
        sigil: diagnostics.sigil,
        power: diagnostics.power,
        onnxRuntime: onnxRuntimeDiagnostics,
        analysisDiagnostics: createDiagnosticExport(),
      });
    }

    function createDiagnosticExport() {
      const showingPreviousRun = Boolean(diagnosticStageState.previousRun?.interrupted);
      const run = showingPreviousRun ? diagnosticStageState.previousRun : session.activeRun || diagnosticStageState.previousRun;
      const currentKnownLiveBytes = !showingPreviousRun && session.activeRun ? diagnosticStageState.currentKnownLiveBytes : run?.currentKnownLiveBytes ?? diagnosticStageState.currentKnownLiveBytes;
      const peakKnownLiveBytes = !showingPreviousRun && session.activeRun ? diagnosticStageState.peakKnownLiveBytes : run?.peakKnownLiveBytes ?? diagnosticStageState.peakKnownLiveBytes;
      return {
        runId: run?.runId || diagnosticStageState.runId,
        startedTimestamp: run?.startedTimestamp ?? null,
        completed: Boolean(run?.completed),
        aborted: Boolean(run?.aborted),
        interrupted: Boolean(run?.interrupted),
        lastStage: run?.trace?.at(-1)?.stage || diagnosticStageState.currentStage,
        currentKnownLiveBytes,
        peakKnownLiveBytes,
        activeWorkers: { ...(!showingPreviousRun && session.activeRun ? diagnosticStageState.activeWorkers : run?.activeWorkers || diagnosticStageState.activeWorkers) },
        runtimeStates: { ...(!showingPreviousRun && session.activeRun ? diagnosticStageState.runtimeStates : run?.runtimeStates || diagnosticStageState.runtimeStates) },
        sourceMatCreateCount: diagnosticStageState.sourceMatCreateCount || run?.sourceMatCreateCount || 0,
        environment: run?.environment || currentEnvironment(),
        localStorageWrites: run?.localStorageWrites ?? diagnosticStageState.localStorageWrites,
        trace: (run?.trace || diagnosticStageState.trace).slice(-DIAGNOSTIC_TRACE_LIMIT),
        ...(run?.error ? { error: run.error } : {}),
      };
    }

    function downloadDiagnosticJson() {
      const report = createDiagnosticExport();
      const timestamp = new Date(report.startedTimestamp || Date.now()).toISOString().replace(/[:.]/g, '-');
      const shortRunId = String(report.runId || 'none').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 8) || 'none';
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `magia-diagnostics-${timestamp}-${shortRunId}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      // Release after the browser has dispatched the download navigation.
      global.setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    function diagnosticCauseForStage(stage) {
      const causes = {
        'ocr-detection-input-buffer-alloc-start': 'Detection Float32入力bufferの確保中に終了した可能性',
        'ocr-detection-run-start': 'Detection ONNX WASM inference中に終了した可能性',
        'ocr-detection-mask-buffer-alloc-start': 'Detection mask Uint8 bufferの確保中に終了した可能性',
        'ocr-opencv-import-start': 'OpenCV moduleのimport中に終了した可能性',
        'ocr-mask-mat-alloc-start': 'OpenCV mask Matの確保中に終了した可能性',
        'ocr-find-contours-start': 'OpenCV findContours内部処理中に終了した可能性',
        'ocr-source-align-buffer-alloc-start': 'source alignment RGBA bufferの確保中に終了した可能性',
        'ocr-source-mat-alloc-start': 'OpenCV source Matの確保中に終了した可能性',
        'ocr-line-materialize-start': 'Recognition対象line cropの実体化中に終了した可能性',
        'ocr-recognition-preprocess-start': 'Recognition前処理中に終了した可能性',
        'ocr-recognition-model-buffer-start': 'Recognition model ArrayBuffer生成中に終了した可能性',
        'ocr-recognition-session-create-start': 'Recognition ONNX Session生成中に終了した可能性',
        'ocr-recognition-input-buffer-alloc-start': 'Recognition Float32入力bufferの確保中に終了した可能性',
        'ocr-recognition-run-start': 'Recognition ONNX WASM inference中に終了した可能性',
        'structure-input-get-image-data-start': 'Structure Worker入力ImageDataの確保中に終了した可能性',
        'structure-worker-run-start': 'Structure Workerの構造解析中に終了した可能性',
        'master-image-get-image-data-start': 'full-size master ImageDataの確保中に終了した可能性',
        'structure-score-run-start': 'Structure score計算中に終了した可能性',
        'vocabulary-response-text-start': '大規模辞書Response.text()中に終了した可能性',
        'vocabulary-json-parse-start': '大規模辞書JSON.parse中に終了した可能性',
        'vocabulary-corrector-create-start': '大規模corrector Map/index生成中に終了した可能性',
        'embedding-worker-create-start': 'Embedding Worker生成中に終了した可能性',
        'embedding-model-load-start': 'Embeddingモデルロード中に終了した可能性',
        'embedding-pipeline-create-start': 'Transformers pipeline生成・モデル接続中に終了した可能性',
        'embedding-run-start': 'Embedding inference中に終了した可能性',
        'image-selection-commit-error': '画像のcanvas反映または選択確定処理で例外が発生した可能性',
      };
      return causes[stage] || (stage?.startsWith('ocr-') ? 'OCR処理中に終了した可能性'
        : stage?.startsWith('embedding-') ? 'Embedding処理中に終了した可能性'
          : stage?.startsWith('structure-') || stage?.startsWith('master-image-') ? 'Structure Analysis処理中に終了した可能性'
            : 'このstage付近で終了した可能性');
    }

    function publishRuntimeDiagnostics() {
      if (!diagnosticsEnabled) return;
      let panel = document.getElementById('analysisRuntimeDiagnostics');
      if (!panel) {
        panel = document.createElement('section');
        panel.id = 'analysisRuntimeDiagnostics';
        panel.setAttribute('aria-label', '画像解析stageとメモリ見積もり');
        panel.style.cssText = 'margin:1rem 0;padding:1rem;border:1px solid #79909a;border-radius:8px;background:#111b25;color:#e5edf0';
        const heading = document.createElement('strong');
        heading.textContent = 'OCR runtime diagnostics';
        const downloadButton = document.createElement('button');
        downloadButton.type = 'button';
        downloadButton.id = 'analysisDiagnosticsDownload';
        downloadButton.textContent = '診断JSONを保存';
        downloadButton.addEventListener('click', downloadDiagnosticJson);
        const output = document.createElement('pre');
        output.id = 'analysisRuntimeDiagnosticsText';
        output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;margin:.5rem 0 0;font:12px/1.6 ui-monospace,monospace';
        const lastEvent = document.createElement('pre');
        lastEvent.id = 'analysisRuntimeDiagnosticsLastEvent';
        lastEvent.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;margin:.5rem 0;padding:.75rem;background:#34261d;color:#fff0d9;font:12px/1.6 ui-monospace,monospace';
        const recentDetails = document.createElement('details');
        const recentSummary = document.createElement('summary');
        recentSummary.textContent = 'Previous 20 events';
        const recentEvents = document.createElement('pre');
        recentEvents.id = 'analysisRuntimeDiagnosticsRecentEvents';
        recentEvents.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace';
        recentDetails.append(recentSummary, recentEvents);
        const traceDetails = document.createElement('details');
        const traceSummary = document.createElement('summary');
        traceSummary.textContent = 'Full trace (up to 64 events)';
        const traceOutput = document.createElement('pre');
        traceOutput.id = 'analysisRuntimeDiagnosticsTrace';
        traceOutput.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:40vh;overflow:auto;font:11px/1.45 ui-monospace,monospace';
        traceDetails.append(traceSummary, traceOutput);
        panel.append(heading, downloadButton, output, lastEvent, recentDetails, traceDetails);
        document.body.append(panel);
      }
      const output = document.getElementById('analysisRuntimeDiagnosticsText');
      const memory = diagnosticStageState.memory || {};
      const memoryMib = bytes => Number.isFinite(bytes) ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : 'pending';
      const previousRun = diagnosticStageState.previousRun;
      const showingPreviousRun = Boolean(previousRun?.interrupted);
      const trace = !showingPreviousRun && session.activeRun?.trace?.length ? session.activeRun.trace : diagnosticStageState.trace || [];
      const visibleTrace = showingPreviousRun ? previousRun.trace : trace.length ? trace : previousRun?.trace || [];
      const last = visibleTrace.at(-1) || null;
      const lastDetails = last?.details || {};
      const previousTraceDetails = showingPreviousRun
        ? [...visibleTrace].reverse().map(event => event.details || {})
        : [];
      const detailFor = key => previousTraceDetails.find(details => Number.isFinite(details[key]))?.[key];
      const displayMemory = showingPreviousRun ? {
        ocrInputWidth: detailFor('ocrInputWidth'),
        ocrInputHeight: detailFor('ocrInputHeight'),
        detectionTensorWidth: detailFor('detectionTensorWidth'),
        detectionTensorHeight: detailFor('detectionTensorHeight'),
        detectionMaskWidth: detailFor('detectionMaskWidth'),
        detectionMaskHeight: detailFor('detectionMaskHeight'),
        inputFloat32EstimatedBytes: detailFor('inputFloat32EstimatedBytes'),
        maskEstimatedBytes: detailFor('maskEstimatedBytes'),
      } : memory;
      const previousOcrSourceWidth = showingPreviousRun ? detailFor('ocrSourceWidth') : session.activeRun?.ocrSourceWidth;
      const previousOcrSourceHeight = showingPreviousRun ? detailFor('ocrSourceHeight') : session.activeRun?.ocrSourceHeight;
      const displayCanvas = showingPreviousRun
        ? previousTraceDetails.find(details => details.canvas)?.canvas || null
        : diagnosticStageState.canvas;
      const lastEstimatedAllocationBytes = Number.isFinite(lastDetails.estimatedBytes)
        ? lastDetails.estimatedBytes
        : Number.isFinite(lastDetails.inputEstimatedBytes) ? lastDetails.inputEstimatedBytes : null;
      const lastEvent = document.getElementById('analysisRuntimeDiagnosticsLastEvent');
      if (lastEvent) {
        lastEvent.textContent = [
          showingPreviousRun ? 'LAST EVENT BEFORE RELOAD' : 'LAST EVENT',
          last ? `#${last.seq} +${last.elapsedMs}ms` : 'No diagnostic events yet',
          last?.stage || diagnosticStageState.currentStage,
          `Likely: ${diagnosticCauseForStage(last?.stage || diagnosticStageState.currentStage)}`,
          Number.isFinite(lastEstimatedAllocationBytes) ? `Estimated allocation: ${memoryMib(lastEstimatedAllocationBytes)}` : null,
          Number.isFinite(lastDetails.currentKnownLiveBytes) ? `Known application-controlled buffers at this event: ${memoryMib(lastDetails.currentKnownLiveBytes)}` : null,
        ].filter(Boolean).join('\n');
      }
      const recentEvents = document.getElementById('analysisRuntimeDiagnosticsRecentEvents');
      if (recentEvents) recentEvents.textContent = visibleTrace.slice(-20)
        .map(event => `#${event.seq} +${event.elapsedMs}ms ${event.stage}${Number.isFinite(event.details?.estimatedBytes) ? ` (${memoryMib(event.details.estimatedBytes)})` : ''}`)
        .join('\n');
      const traceOutput = document.getElementById('analysisRuntimeDiagnosticsTrace');
      if (traceOutput) traceOutput.textContent = JSON.stringify(visibleTrace, null, 2);
      output.textContent = [
        `Previous interrupted run: ${showingPreviousRun ? 'yes' : 'no'}`,
        `Current stage: ${showingPreviousRun ? previousRun.lastStage || last?.stage : diagnosticStageState.currentStage}`,
        `Previous interrupted stage: ${showingPreviousRun ? previousRun.lastStage || last?.stage : diagnosticStageState.previousInterruptedStage}`,
        `Run ID: ${showingPreviousRun ? previousRun.runId : diagnosticStageState.runId}`,
        `Known application-controlled buffers (current): ${memoryMib(!showingPreviousRun && session.activeRun ? diagnosticStageState.currentKnownLiveBytes : previousRun?.currentKnownLiveBytes ?? diagnosticStageState.currentKnownLiveBytes)}`,
        `Known application-controlled buffers (peak): ${memoryMib(!showingPreviousRun && session.activeRun ? diagnosticStageState.peakKnownLiveBytes : previousRun?.peakKnownLiveBytes ?? diagnosticStageState.peakKnownLiveBytes)}`,
        `Active workers: ${JSON.stringify(!showingPreviousRun && session.activeRun ? diagnosticStageState.activeWorkers : previousRun?.activeWorkers || diagnosticStageState.activeWorkers)}`,
        `Runtime states: ${JSON.stringify(!showingPreviousRun && session.activeRun ? diagnosticStageState.runtimeStates : previousRun?.runtimeStates || diagnosticStageState.runtimeStates)}`,
        `OpenCV source Mat create count: ${diagnosticStageState.sourceMatCreateCount || previousRun?.sourceMatCreateCount || 0}`,
        `LocalStorage diagnostic writes: ${showingPreviousRun ? previousRun.localStorageWrites ?? 0 : diagnosticStageState.localStorageWrites}`,
        `Analysis canvas estimated RGBA backing: ${displayCanvas ? `${displayCanvas.width}x${displayCanvas.height} (${memoryMib(displayCanvas.estimatedRgbaBackingBytes)})` : 'pending'}`,
        `OCR input: ${displayMemory.ocrInputWidth ?? previousOcrSourceWidth ?? lastDetails.ocrSourceWidth ?? 'pending'}x${displayMemory.ocrInputHeight ?? previousOcrSourceHeight ?? lastDetails.ocrSourceHeight ?? 'pending'}`,
        `Detection tensor: ${displayMemory.detectionTensorWidth ?? 'pending'}x${displayMemory.detectionTensorHeight ?? 'pending'}`,
        `Detection mask: ${displayMemory.detectionMaskWidth ?? 'pending'}x${displayMemory.detectionMaskHeight ?? 'pending'}`,
        `Input Float32 estimated: ${memoryMib(displayMemory.inputFloat32EstimatedBytes)}`,
        `Mask estimated: ${memoryMib(displayMemory.maskEstimatedBytes)}`,
        `ONNX Runtime version: ${onnxRuntimeDiagnostics.version}`,
        `Execution provider: ${onnxRuntimeDiagnostics.executionProvider}`,
        `Graph optimization level: ${onnxRuntimeDiagnostics.graphOptimizationLevel} (${onnxRuntimeDiagnostics.graphOptimizationLevelSource})`,
        `Execution mode: ${onnxRuntimeDiagnostics.executionMode}`,
        `numThreads: ${onnxRuntimeDiagnostics.numThreads}`,
        `enableCpuMemArena: ${onnxRuntimeDiagnostics.enableCpuMemArena}`,
        `enableMemPattern: ${onnxRuntimeDiagnostics.enableMemPattern}`,
        `Detection tensor shape: ${showingPreviousRun && displayMemory.detectionTensorHeight && displayMemory.detectionTensorWidth
          ? `1x3x${displayMemory.detectionTensorHeight}x${displayMemory.detectionTensorWidth}`
          : onnxRuntimeDiagnostics.detectionTensorShape?.join('x') ?? 'pending'}`,
        ...(diagnosticStageState.error ? [`Last OCR error: ${diagnosticStageState.error}`] : []),
      ].join('\n');
    }


    return { diagnostics, publishDiagnostics, publishRuntimeDiagnostics, createDiagnosticExport };
  }

  global.MagiaCircleDiagnosticView = Object.freeze({ create });
}(globalThis));
