## Presentation generator idea

The goal is to create a presentation generator. The user will describe a presentation and the AI will generate code to build it using PPTX and render it.

### UI
- Chat is on the left side
- Preview of the PPTX is on the right side

### How the backend works
- An open-source AI model such as DeepSeek V4 Flash will write code and create a PPTX file based on the users instructions
- Then somehow this completed PPTX file in the Daytona sandbox will be converted to a PDF and rendered in the browser in the right side panel

### How Daytona.io is relevant

- The AI will write and execute python-pptx code in the Daytona.io sandbox and produce a finished PPTX file
- Then the AI or some automatic process will convert this generated PPTX into a PDF that is rendered on the frontend

### Key challenges
- How do we convert the generated PPTX file into a PDF and render it on the frontend?
    - One idea is for the AI to call a tool on the generated PPTX file to convert it to a PDF and render it on the frontend somehow