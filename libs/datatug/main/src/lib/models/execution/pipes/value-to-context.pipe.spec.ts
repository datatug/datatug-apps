import { IValueToContextPipeDefinition } from '../../definition/pipe-definition';
import { ValueToContextPipe } from './value-to-context.pipe';

const pipe = (from: string) =>
  new ValueToContextPipe({
    id: 'p1',
    title: 'Pipe',
    from,
    to: 'target',
  } as IValueToContextPipeDefinition);

describe('ValueToContextPipe', () => {
  it.each([
    ['a', { a: { x: 1 } }, { x: 1 }],
    ['missing', { a: 1 }, undefined],
    ['', { '': 'empty-key' }, 'empty-key'],
  ])('process(from=%j) on %j outputs %j', (from, input, expected) => {
    expect(pipe(from).process(input)).toEqual({ output: expected });
  });
});
