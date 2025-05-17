import { ZodArray, ZodObject, ZodString, type ZodTypeAny, z } from 'zod';
import OpenAI from 'openai';
import YAML from 'yaml';
import PartialJSON from 'partial-json';
import type { ChatCompletionContentPart } from 'openai/src/resources.js';

/**
 * Options for initializing the PromptPig client.
 */
type PromptPigOptions = {
  /**
   * An existing OpenAI client instance.
   * Required if `baseURL` and `apiKey` are not provided.
   */
  openai?: OpenAI;

  /**
   * Base URL for an OpenAI-compatible API.
   * Required if `openai` is not provided.
   */
  baseURL?: string;

  /**
   * API key for the OpenAI-compatible API.
   * Required if `openai` is not provided.
   */
  apiKey?: string;

  /**
   * Optional default model to use for all prompts.
   */
  model?: string;
};

/**
 * Options for creating a single prompt.
 */
type PromptOptions<Schm extends ZodTypeAny = ZodString> = {
  /**
   * Model to use for this prompt, if different from the default.
   */
  model?: string;

  /**
   * Zod schema used to validate the output.
   * If omitted, defaults to `z.string()`.
   */
  schema?: Schm;
};

type StreamOutput<Schm extends ZodTypeAny> =
  Schm extends ZodArray<infer U> ? z.infer<U> : string;

const extractCode = (text: string): string => {
  const codeBlockExp = /\n? *```\w* *\n?/g;
  const matches = [...text.matchAll(codeBlockExp)];

  if (matches.length === 0) {
    return text;
  }

  if (matches.length === 1) {
    return text.slice(matches[0]!.index! + matches[0]![0].length);
  }

  const start = matches[0]!.index! + matches[0]![0].length;
  const end = matches[1]!.index!;
  return text.slice(start, end);
};

const parseAny = (text: string) => {
  try {
    return PartialJSON.parse(text);
  } catch {
    try {
      return YAML.parse(text, { logLevel: 'error' });
    } catch {
      return text;
    }
  }
};

/**
 * Main client for creating and managing typed prompts.
 *
 * @example
 * const pp = new PromptPig({ baseURL: '...', apiKey: '...' });
 * const prompt = pp.prompt((x) => `Say hello to ${x}`, { schema: z.string() });
 * const result = await prompt.run('Alice');
 */
class PromptPig {
  private openai: OpenAI;
  private model?: string;

  constructor({ openai, baseURL, apiKey, model }: PromptPigOptions) {
    if (!openai && !(baseURL && apiKey)) {
      throw new Error(
        'Either an openai object or a baseURL and apiKey need to be provided in the PromptPig options.',
      );
    }

    this.openai = openai ?? new OpenAI({ baseURL, apiKey });
    this.model = model;
  }

  /**
   * Create a new typed prompt using a template function.
   *
   * @param template - A function that returns a prompt string or OpenAI "content" array
   * @param options - Optional model and schema for output validation
   */
  prompt<
    Tmpl extends (...args: any[]) => string | ChatCompletionContentPart[],
    Schm extends ZodTypeAny = ZodString,
  >(template: Tmpl, options?: PromptOptions<Schm>): Prompt<Tmpl, Schm> {
    const model = this.model ?? options?.model;
    if (!model) {
      throw new Error(
        'A model needs to be provided in the PromptPig options or in the .prompt() options.',
      );
    }

    const promptOptions = {
      openai: this.openai,
      model,
      schema: options?.schema,
    };
    return new Prompt(template, promptOptions);
  }
}

/**
 * A prompt that can be run or streamed.
 */
class Prompt<
  Tmpl extends (...args: any[]) => string | ChatCompletionContentPart[],
  Schm extends ZodTypeAny = ZodString,
> {
  private template: Tmpl;
  private openai: OpenAI;
  private model: string;
  private schema: Schm;

  constructor(
    template: Tmpl,
    options: { openai: OpenAI; model: string; schema?: Schm },
  ) {
    this.template = template;
    this.openai = options.openai;
    this.model = options.model;
    this.schema = (options.schema ?? z.string()) as Schm;
  }

  /**
   * Run the prompt once and validate the result.
   * Takes the arguments from the template function.
   *
   * @returns Parsed result if valid, otherwise `undefined`.
   */
  async run(...args: Parameters<Tmpl>): Promise<z.infer<Schm> | undefined> {
    const content = this.template(...args);

    const completion = await this.openai.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content }],
    });

    const msg = completion.choices[0]?.message.content;
    if (typeof msg !== 'string') {
      return undefined;
    }

    const schemaArray = this.schema instanceof ZodArray;
    const schemaObj = this.schema instanceof ZodObject;
    const isCode = schemaArray || schemaObj;
    const extract = isCode ? extractCode(msg) : msg;

    const schemaStr = this.schema instanceof ZodString;
    const data = schemaStr ? extract : parseAny(extract);

    const result = this.schema.safeParse(data);
    return result.success ? result.data : undefined;
  }

  /**
   * Stream the result of the prompt.
   * Takes the arguments from the template function.
   * If the schema is an array, items will be streamed one-by-one.
   */
  async *stream(...args: Parameters<Tmpl>): AsyncGenerator<StreamOutput<Schm>> {
    const content = this.template(...args);

    const stream = await this.openai.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content }],
      stream: true,
    });

    let buffer = '';
    let itemsDone = 0;

    for await (const event of stream) {
      const m = event.choices[0]?.delta.content;
      if (typeof m !== 'string' || !m.length) continue;

      if (!(this.schema instanceof ZodArray)) {
        yield m as StreamOutput<Schm>;
        continue;
      }

      buffer += m;
      const extract = extractCode(buffer);
      const data = parseAny(extract);
      if (!Array.isArray(data)) continue;

      for (let i = itemsDone; i < data.length - 1; i++) {
        const parse = this.schema.element.safeParse(data[i]);
        if (parse.success) yield parse.data;
        itemsDone++;
      }
    }

    if (!(this.schema instanceof ZodArray)) return;
    const extract = extractCode(buffer);
    const data = parseAny(extract);
    if (!Array.isArray(data)) return;

    for (let i = itemsDone; i < data.length; i++) {
      const parse = this.schema.element.safeParse(data[i]);
      if (parse.success) yield parse.data;
    }
  }
}

export { PromptPig, z };
