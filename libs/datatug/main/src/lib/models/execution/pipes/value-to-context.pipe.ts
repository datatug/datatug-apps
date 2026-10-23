import { ITugPipe, ITugPipeOutput } from '../../pipe';
import { IValueToContextPipeDefinition } from '../../definition/pipe-definition';

export class ValueToContextPipe implements ITugPipe {
  constructor(private readonly definition: IValueToContextPipeDefinition) {}

  process(input: Record<string, unknown>): ITugPipeOutput {
    const from = this.definition.from.split('.');
    // Walk the dotted path: each segment is read from the value the previous one produced.
    let v: unknown = input;
    for (const f of from) {
      v = (v as Record<string, unknown> | undefined)?.[f];
    }
    // const {to} = this.definition;
    // const variables = {...(ctx.variables || {})};
    // variables[to] = v;
    return { output: v as Record<string, unknown> | undefined };
  }
}
