import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { IntroVideo, IntroVideoComponent } from './intro-video.component';

const VIDEO: IntroVideo = {
  youtubeId: 'PjVOaOd-ero',
  title: 'DataTug introduction (draft)',
  posterSrc: 'assets/home/intro-video-poster.webp',
};

describe('IntroVideoComponent', () => {
  let fixture: ComponentFixture<IntroVideoComponent>;
  let root: HTMLElement;

  const render = (video: IntroVideo) => {
    TestBed.configureTestingModule({
      imports: [IntroVideoComponent],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    });
    fixture = TestBed.createComponent(IntroVideoComponent);
    fixture.componentRef.setInput('video', video);
    fixture.detectChanges();
    root = fixture.nativeElement;
  };

  afterEach(() => TestBed.resetTestingModule());

  it('shows only the local poster before play, so nothing loads from YouTube', () => {
    render(VIDEO);
    const button = root.querySelector('[data-testid="intro-video-play"]');
    expect(button?.getAttribute('aria-label')).toBe(
      'Play video: DataTug introduction (draft)',
    );
    expect(root.querySelector('img')?.getAttribute('src')).toBe(VIDEO.posterSrc);
    expect(root.querySelector('iframe')).toBeNull();
    expect(root.innerHTML).not.toContain('youtube');
  });

  it('loads the privacy-enhanced player after the visitor presses play', async () => {
    render(VIDEO);
    (root.querySelector('[data-testid="intro-video-play"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    const iframe = root.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.src).toBe(
      'https://www.youtube-nocookie.com/embed/PjVOaOd-ero?autoplay=1&rel=0',
    );
    expect(iframe.title).toBe(VIDEO.title);
    expect(root.querySelector('[data-testid="intro-video-play"]')).toBeNull();
  });

  it('renders nothing for an ID that is not a YouTube video ID', () => {
    render({ ...VIDEO, youtubeId: 'x"><script>' });
    expect(root.querySelector('[data-testid="intro-video"]')).toBeNull();
  });
});
