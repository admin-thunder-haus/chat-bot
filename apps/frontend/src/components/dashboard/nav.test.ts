import { describe, expect, it } from 'vitest';
import { DEFAULT_FEATURES, type PlatformFeatures } from '@/lib/types';
import { NAV_SECTIONS, visibleNavSections, type NavSection } from './nav';

const ON: PlatformFeatures = { billing: true, aiActions: true };
const OFF: PlatformFeatures = { billing: false, aiActions: false };

function hrefs(sections: NavSection[]): string[] {
  return sections.flatMap((s) => s.items.map((i) => i.href));
}

describe('visibleNavSections', () => {
  it('hides Billing when the platform reports billing off', () => {
    expect(hrefs(visibleNavSections(NAV_SECTIONS, OFF))).not.toContain(
      '/dashboard/billing',
    );
  });

  it('shows Billing when the platform reports billing on', () => {
    expect(hrefs(visibleNavSections(NAV_SECTIONS, ON))).toContain(
      '/dashboard/billing',
    );
  });

  it('hides Billing under the conservative pre-auth defaults', () => {
    expect(
      hrefs(visibleNavSections(NAV_SECTIONS, DEFAULT_FEATURES)),
    ).not.toContain('/dashboard/billing');
  });

  it('leaves every ungated entry alone', () => {
    const ungated = hrefs(NAV_SECTIONS).filter(
      (h) => h !== '/dashboard/billing',
    );
    expect(hrefs(visibleNavSections(NAV_SECTIONS, OFF))).toEqual(ungated);
  });

  it('drops a section that becomes empty', () => {
    const sections: NavSection[] = [
      {
        title: 'Money',
        items: [
          {
            label: 'Billing',
            href: '/dashboard/billing',
            icon: 'billing',
            requires: 'billing',
          },
        ],
      },
    ];
    expect(visibleNavSections(sections, OFF)).toEqual([]);
    expect(visibleNavSections(sections, ON)).toHaveLength(1);
  });
});
