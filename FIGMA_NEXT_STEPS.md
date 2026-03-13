# Figma UI Redesign – Next Steps

## Completed
- [x] Full backup created: `public/backup_ui_20260313_1919/`
- [x] Figma Make prompt saved: `FIGMA_MAKE_PROMPT.txt`
- [x] Current UI captured to Figma: https://www.figma.com/design/rwZMjGFLkBCjbWHMedJU5T

## Option A: Create new design in Figma Make

1. **Open Figma Make**: https://figma.com/make
2. **Copy the prompt** from `FIGMA_MAKE_PROMPT.txt` and paste it into Figma Make
3. **Let Figma generate** the design
4. **Select the main frame** in the generated design
5. **Share** → Copy link (format: `https://figma.com/design/FILE_KEY/FileName?node-id=X-Y`)
6. **Paste the Figma URL here** and ask to implement

## Option B: Transform the captured design

1. **Open the captured file**: https://www.figma.com/design/rwZMjGFLkBCjbWHMedJU5T
2. Use **Figma Make** (or duplicate + edit) to transform it into a "wild" new look
3. **Share** the frame URL when done
4. Paste the URL here and ask to implement

Once you provide the Figma URL, the implementation will:
- Use `get_design_context` and `get_screenshot` from Figma MCP
- Replace `index.html` and `style.css` with the new design
- Preserve all IDs and classes so `app.js` continues to work
- Keep `app.js` unchanged
