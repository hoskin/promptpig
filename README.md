# TSPrompt

**TSPrompt** is a lightweight TypeScript-first wrapper for LLMs like OpenAI, OpenRouter, and others. It helps you write structured, type-safe prompts by turning your templates into callable, validated functions.

No more messy prompt spaghetti or unsafe parsing. Instead, clean and declarative LLM calls with full TypeScript support.

## ✨ Features

* ✅ Write prompts as regular functions
* ✅ Supports JSON or YAML prompt response formats
* ✅ Define output structure with [Zod](https://github.com/colinhacks/zod)
* ✅ Type-safe `.run()` and `.stream()` methods
* ✅ Stream array response items one by one
* ✅ Compatible with OpenAI and OpenAI-compatible APIs

## 📦 Installation

```bash
npm install tsprompt
# or
bun install tsprompt
# or
yarn add tsprompt
```

## 🚀 Quick Start

### 1. Setup

```ts
import { TSPrompt, z } from 'tsprompt';
import OpenAI from 'openai'; // if passing OpenAI object manually

// Option A: Provide baseURL and apiKey for any OpenAI-compatible API
const tsp = new TSPrompt({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: 'your-api-key',
});

// Option B: Pass an existing OpenAI client instance
const tsp = new TSPrompt({
  openai: new OpenAI({ apiKey: 'your-api-key' }),
});

// Optional: Pass a default model for all prompts
const tsp = new TSPrompt({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: 'your-api-key',
  model: 'deepseek/deepseek-r1',
});
```

### 2. Create a Prompt

```ts
// A template is just a function that returns a prompt string
const template = (country: string) => `\
Generate 5 fake people who live in ${country}.
Respond with a JSON array like:
[{ "name": "Alice", "age": 30 }, ...]`;

// If no schema is passed, TSPrompt assumes z.string()
const schema = z
  .array(
    z.object({
      name: z.string(),
      age: z.number(),
    }),
  )
  .length(5);

const peoplePrompt = tsp.prompt(template, { schema });
```

### 3. Run the Prompt

```ts
const people = await peoplePrompt.run('France');

// undefined if the output is invalid or not parsable
if (people === undefined) return;

// people is typed: Array<{ name: string; age: number }>
console.log(people[4].name); // safely typed
```

> For object or array schemas, TSPrompt extracts and parses content from the first JSON or YAML code block in the LLM's response. No need to worry about "Okay! Here you go:" type preamble.

### 4. Stream Results

```ts
for await (const person of peoplePrompt.stream('Vietnam')) {
  console.log(person.name, person.age);
}
```

> Streams yield items from the array one by one **if the schema is an array**.
If the schema is a string or other format, raw chunks are streamed.

## 📄 License

MIT
