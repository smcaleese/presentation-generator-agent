# How the AI writes code and it gets run

Each box shows the function that runs and its main arguments. The file is in brackets.

```mermaid
flowchart TD
    A["User sends a message<br/>POST /api/chats/:id/messages<br/>[routes.ts]"]
    A --> B["runTurn(chatId, messageId, prompt, emit)<br/>messageId = the saved user message<br/>[pipeline.ts]"]
    B --> C["streamAgentStep(input, handlers)<br/>calls DeepSeek with the createSlides tool<br/>handlers: onReasoning, onText, onCode<br/>[llm.ts]"]
    C -- "no tool call: greeting or question" --> R["persist(text)<br/>AI replies in text, no build"]
    C -- "tool call: createSlides" --> D["parseCode(call.arguments)<br/>reads the code string out of the JSON<br/>[pipeline.ts]"]
    D -- "missing or blank code" --> J
    D -- "got code" --> E["runBuild(chatId, messageId, code, emit)<br/>saves DeckVersion status = building<br/>[pipeline.ts]"]
    E --> F["postBuild(chatId, messageId, code)<br/>waits for a free slot, then<br/>POST RUNNER_URL/build<br/>body: chat_id, message_id, code<br/>[runner.ts]"]
    F --> G["build(req)<br/>mkdir /tmp/builds/chat_id/message_id<br/>runs: python build.py<br/>[runner/app.py]"]
    G --> H{"deck.pptx written?"}
    H -- "yes: 200 + pptx bytes" --> I["pptxToSlides(pptxBytes)<br/>soffice --convert-to pdf<br/>pdftoppm -png -r 150<br/>returns pdfBytes, slidePngs<br/>[render.ts]"]
    I --> K["Save files to storage/chatId/version<br/>DeckVersion status = ready<br/>emit build:done"]
    K --> L["toolResult = built deck with N slides"]
    H -- "no: 422 + Python output" --> M["BuildError thrown<br/>DeckVersion status = error<br/>emit build:error"]
    M --> J["toolResult = the error text"]
    L --> N["input.push(function_call_output, call_id, toolResult)<br/>[pipeline.ts]"]
    J --> N
    N -- "next step, up to MAX_STEPS = 5" --> C
```

- **On success** the next `streamAgentStep` lets the AI write its short summary, and the loop ends when it answers without a tool call.
- **On an error** the same loop runs again, and the AI reads the error and calls `createSlides` with fixed code.
- **The runner** deletes `/tmp/builds/<chatId>/<messageId>` when the build ends, and it has no secrets and no network access.
- **Two similar names:** `runBuild` in `pipeline.ts` does the whole build (runner, render, save). `postBuild` in `runner.ts` is only the HTTP POST to the runner.
