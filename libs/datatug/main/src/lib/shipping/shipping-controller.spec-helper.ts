import {
  Component,
  EnvironmentInjector,
  createEnvironmentInjector,
  type Type,
  type Provider,
  type WritableSignal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';

@Component({ template: '' })
class ControllerLifetimeFixture {}
/** Controller unit lifetime only; this helper makes no DOM/presentation assertion. */
export async function mountShippingController<T>(
  type: Type<T>,
  providers: Provider[] = [],
) {
  const fixture = TestBed.createComponent(ControllerLifetimeFixture);
  const injector = createEnvironmentInjector(
    [type, ...providers],
    TestBed.inject(EnvironmentInjector),
  );
  fixture.componentRef.onDestroy(() => {
    if (!injector.destroyed) injector.destroy();
  });
  const componentInstance = injector.get(type);
  const whenStable = async () => {
    TestBed.tick();
    await fixture.whenStable();
    TestBed.tick();
    await Promise.resolve();
  };
  return {
    componentInstance,
    whenStable,
    detectChanges: () => fixture.detectChanges(),
    destroy: () => fixture.destroy(),
    setInput: (key: string, value: unknown) => {
      const field = (componentInstance as Record<string, unknown>)[
        key
      ] as WritableSignal<unknown>;
      field.set(value);
    },
  };
}
