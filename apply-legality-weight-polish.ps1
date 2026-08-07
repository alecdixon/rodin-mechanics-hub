$ErrorActionPreference = "Stop"

$root = Get-Location
$pagePath = Join-Path $root "app\legality\page.tsx"
$routePath = Join-Path $root "app\api\legality\route.ts"

if (!(Test-Path $pagePath)) {
  throw "Could not find app\legality\page.tsx. Run this from the rodin-mechanics-hub backup project root."
}

if (!(Test-Path $routePath)) {
  throw "Could not find app\api\legality\route.ts. Run this from the rodin-mechanics-hub backup project root."
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $pagePath "$pagePath.bak-$stamp" -Force
Copy-Item $routePath "$routePath.bak-$stamp" -Force

$page = Get-Content $pagePath -Raw

$pageCornerWeightsBlock = @'
<div className="border-b border-zinc-700 bg-[#05070b] px-5 py-5">
            <div className="mx-auto max-w-6xl">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="pb-0.5 text-[10px] font-black uppercase leading-none tracking-[0.3em] text-zinc-400">
                    Corner Weight Measurements
                  </p>
                  <p className="mt-2 text-xs leading-5 text-zinc-400">
                    Manual entry for the legality sheet. Total weight is not auto-calculated.
                  </p>
                </div>
                <span className="rounded-full border border-zinc-700 bg-[#0b0f14] px-3 py-1.5 text-[10px] font-black uppercase leading-none tracking-[0.2em] text-zinc-300">
                  kg
                </span>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                {([
                  ["fl", "FL", "Front Left"],
                  ["fr", "FR", "Front Right"],
                ] as const).map(([key, label, helper]) => (
                  <label
                    key={key}
                    className="rounded-2xl border border-zinc-700 bg-[#0b0f14] p-4 shadow-inner shadow-black/20"
                  >
                    <span className="block pb-0.5 text-[10px] font-black uppercase leading-none tracking-[0.28em] text-zinc-500">
                      {label}
                    </span>
                    <input
                      disabled={readOnly}
                      inputMode="decimal"
                      value={cornerWeights[key]}
                      onChange={(event) => updateCornerWeight(key, event.target.value)}
                      placeholder="0.0"
                      className="mt-3 h-12 w-full rounded-xl border border-zinc-700 bg-[#10151b] px-4 text-lg font-bold leading-none text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 disabled:cursor-not-allowed disabled:bg-zinc-900 disabled:text-zinc-500"
                    />
                    <div className="mt-2 text-[11px] leading-none text-zinc-500">{helper}</div>
                  </label>
                ))}

                <div className="hidden lg:block" aria-hidden="true" />

                {([
                  ["rl", "RL", "Rear Left"],
                  ["rr", "RR", "Rear Right"],
                  ["total", "TOTAL", "Total Weight"],
                ] as const).map(([key, label, helper]) => (
                  <label
                    key={key}
                    className="rounded-2xl border border-zinc-700 bg-[#0b0f14] p-4 shadow-inner shadow-black/20"
                  >
                    <span className="block pb-0.5 text-[10px] font-black uppercase leading-none tracking-[0.28em] text-zinc-500">
                      {label}
                    </span>
                    <input
                      disabled={readOnly}
                      inputMode="decimal"
                      value={cornerWeights[key]}
                      onChange={(event) => updateCornerWeight(key, event.target.value)}
                      placeholder="0.0"
                      className="mt-3 h-12 w-full rounded-xl border border-zinc-700 bg-[#10151b] px-4 text-lg font-bold leading-none text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 disabled:cursor-not-allowed disabled:bg-zinc-900 disabled:text-zinc-500"
                    />
                    <div className="mt-2 text-[11px] leading-none text-zinc-500">{helper}</div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          
'@

$pagePattern = '(?s)<div className="border-b border-zinc-700 bg-\[#05070b\] px-5 py-4">\s*<div className="mx-auto max-w-4xl">.*?</div>\s*</div>\s*(?=<div\s+className=\{`p-4)'
$newPage = [regex]::Replace($page, $pagePattern, $pageCornerWeightsBlock, 1)

if ($newPage -eq $page) {
  throw "Could not find the existing Corner Weight Measurements block in app\legality\page.tsx. No files were changed."
}

Set-Content -Path $pagePath -Value $newPage -NoNewline

$route = Get-Content $routePath -Raw

$newDrawCornerWeightsPanel = @'
  function drawCornerWeightsPanel(x: number, y: number, width: number, height: number) {
    const panelHeight = Math.max(height, 78);
    const cells = [
      { label: "FL", helper: "Front Left", value: payload.corner_weights.fl, row: 0, col: 0 },
      { label: "FR", helper: "Front Right", value: payload.corner_weights.fr, row: 0, col: 1 },
      { label: "RL", helper: "Rear Left", value: payload.corner_weights.rl, row: 1, col: 0 },
      { label: "RR", helper: "Rear Right", value: payload.corner_weights.rr, row: 1, col: 1 },
      { label: "TOTAL", helper: "Total Weight", value: payload.corner_weights.total, row: 1, col: 2 },
    ] as const;

    page.drawRectangle({
      x,
      y,
      width,
      height: panelHeight,
      color: panelBlack,
      borderColor: borderGrey,
      borderWidth: 0.85,
    });

    const titleY = y + panelHeight - 15;
    drawText("CORNER WEIGHTS", x + 10, titleY, 7.2, boldFont, grey);
    drawText("kg", x + width - 22, titleY, 6.8, boldFont, grey);

    const innerX = x + 10;
    const innerY = y + 8;
    const innerWidth = width - 20;
    const cellGap = 7;
    const rowGap = 6;
    const cellW = (innerWidth - cellGap * 2) / 3;
    const cellH = (panelHeight - 32 - rowGap) / 2;

    cells.forEach((cell) => {
      const cellX = innerX + cell.col * (cellW + cellGap);
      const cellY = innerY + (1 - cell.row) * (cellH + rowGap);

      page.drawRectangle({
        x: cellX,
        y: cellY,
        width: cellW,
        height: cellH,
        color: sheetBlack,
        borderColor: borderGrey,
        borderWidth: 0.65,
      });

      drawText(cell.label, cellX + 7, cellY + cellH - 10, 6.3, boldFont, grey);
      drawText(cell.helper, cellX + 7, cellY + cellH - 18, 5.2, normalFont, grey);

      const displayValue = formatCornerWeight(cell.value);
      const valueSize = displayValue.length > 10 ? 7.6 : displayValue.length > 8 ? 8.4 : 9.2;
      const safeValue = wrapTextByWidth(displayValue, boldFont, valueSize, cellW - 14).slice(0, 1)[0] || "—";
      drawText(safeValue, cellX + 7, cellY + 4.5, valueSize, boldFont, dark);
    });
  }

'@

$routePanelPattern = '(?s)  function drawCornerWeightsPanel\(x: number, y: number, width: number, height: number\) \{.*?\r?\n  \}\r?\n\r?\n(?=  function drawComponentCard)'
$newRoute = [regex]::Replace($route, $routePanelPattern, $newDrawCornerWeightsPanel, 1)

if ($newRoute -eq $route) {
  throw "Could not find drawCornerWeightsPanel in app\api\legality\route.ts. Page UI was already changed, but the PDF route was not changed. Restore from the backup if needed."
}

$newRoute = [regex]::Replace($newRoute, 'drawCornerWeightsPanel\(14,\s*\d+,\s*pageWidth - 28,\s*\d+\);', 'drawCornerWeightsPanel(14, 662, pageWidth - 28, 78);', 1)
$newRoute = [regex]::Replace($newRoute, 'const carPanelH = 52\d;', 'const carPanelH = 516;', 1)
$newRoute = $newRoute.Replace('PDF layout: portrait-app-v9-polished', 'PDF layout: portrait-app-v10-weight-polish')
$newRoute = $newRoute.Replace('PDF layout: portrait-app-v8-corner-top', 'PDF layout: portrait-app-v10-weight-polish')

$listTitleOld = @'
    page.drawText(`${payload.car_name} · ${payload.driver} · ${payload.circuit} · ${formatReportDate(payload.check_date)}`, {
      x: margin,
      y,
      size: 14,
      font: boldFont,
      color: dark,
    });
    y -= 22;
'@

$listTitleNew = @'
    const listTitleLines = wrapTextByWidth(
      `${payload.car_name} · ${payload.driver} · ${payload.circuit} · ${formatReportDate(payload.check_date)}`,
      boldFont,
      11.5,
      usableWidth,
    ).slice(0, 2);

    listTitleLines.forEach((line, index) => {
      page.drawText(line, {
        x: margin,
        y: y - index * 13,
        size: 11.5,
        font: boldFont,
        color: dark,
      });
    });
    y -= listTitleLines.length * 13 + 10;
'@

if ($newRoute.Contains($listTitleOld)) {
  $newRoute = $newRoute.Replace($listTitleOld, $listTitleNew)
}

$listWeightsNew = @'
    const listWeights = [
      ["FL", payload.corner_weights.fl],
      ["FR", payload.corner_weights.fr],
      ["RL", payload.corner_weights.rl],
      ["RR", payload.corner_weights.rr],
      ["TOTAL", payload.corner_weights.total],
    ] as const;

    const listWeightBoxH = 44;
    page.drawRectangle({
      x: margin,
      y: y - listWeightBoxH,
      width: usableWidth,
      height: listWeightBoxH,
      color: panelBlack,
      borderColor: borderGrey,
      borderWidth: 0.55,
    });
    page.drawText("CORNER WEIGHTS", {
      x: margin + 8,
      y: y - 14,
      size: 7,
      font: boldFont,
      color: grey,
    });

    const listCellStartX = margin + 112;
    const listCellGap = 5;
    const listCellW = (usableWidth - 124 - listCellGap * 4) / 5;

    listWeights.forEach(([label, value], index) => {
      const cellX = listCellStartX + index * (listCellW + listCellGap);
      page.drawRectangle({
        x: cellX,
        y: y - listWeightBoxH + 8,
        width: listCellW,
        height: 27,
        color: sheetBlack,
        borderColor: borderGrey,
        borderWidth: 0.35,
      });
      page.drawText(label, {
        x: cellX + 6,
        y: y - 18,
        size: 6,
        font: boldFont,
        color: grey,
      });
      const displayValue = formatCornerWeight(value);
      const valueSize = displayValue.length > 10 ? 6.8 : 7.6;
      page.drawText(displayValue, {
        x: cellX + 6,
        y: y - 31,
        size: valueSize,
        font: boldFont,
        color: dark,
      });
    });
    y -= listWeightBoxH + 10;
'@

$listWeightsPattern = '(?s)    const listWeights = \[.*?\] as const;\s*\r?\n\s*page\.drawRectangle\(\{\s*x: margin,\s*y: y - 28,.*?\r?\n\s*y -= 34;'
$routeBeforeWeights = $newRoute
$newRoute = [regex]::Replace($newRoute, $listWeightsPattern, $listWeightsNew, 1)

if ($newRoute -eq $routeBeforeWeights) {
  Write-Warning "Could not auto-polish the page-2 corner weight strip. Page 1 PDF and app UI were still updated."
}

Set-Content -Path $routePath -Value $newRoute -NoNewline

Write-Host "Done. Updated:" -ForegroundColor Green
Write-Host " - app\legality\page.tsx"
Write-Host " - app\api\legality\route.ts"
Write-Host "Backups created with suffix .bak-$stamp"
Write-Host "Next: npm run build" -ForegroundColor Cyan
