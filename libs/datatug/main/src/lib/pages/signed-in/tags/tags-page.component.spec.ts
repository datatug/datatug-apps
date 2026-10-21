import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProjectContextService } from '../../../services/project/project-context.service';
import { BehaviorSubject, of } from 'rxjs';

import { TagsPageComponent } from './tags-page.component';

describe('TagsPage', () => {
  let component: TagsPageComponent;
  let fixture: ComponentFixture<TagsPageComponent>;
  const params = new BehaviorSubject(convertToParamMap({}));
  const query = new BehaviorSubject(convertToParamMap({}));
  const snapshot = { routeConfig: { path: 'tag' } };


  beforeEach(async () => {
    params.next(convertToParamMap({}));
    query.next(convertToParamMap({}));
    snapshot.routeConfig.path = 'tag';
    await TestBed.configureTestingModule({
      imports: [TagsPageComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params,
            queryParamMap: query, snapshot,
          },
        },
        {
          provide: ProjectContextService,
          useValue: { current$: of(undefined) },
        },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(TagsPageComponent, {
        set: {
          imports: [],
          template: '',
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
          providers: [],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(TagsPageComponent);
    component = fixture.componentInstance;
  });

  it('reads opaque query tags only on the static detail route and validates them', () => {
    query.next(convertToParamMap({tag: '..'}));
    expect(component.tag()).toBe('..');
    expect(component.tagError()).toBe('');
    query.next(convertToParamMap({tag: 'é'.repeat(26)}));
    expect(component.tagError()).toContain('50');
    params.next(convertToParamMap({tag: 'Case'}));
    expect(component.tag()).toBe('Case');
    snapshot.routeConfig.path = 'tags';
    params.next(convertToParamMap({}));
    expect(component.tag()).toBeUndefined();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
