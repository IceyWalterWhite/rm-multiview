import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IcpFooter } from './IcpFooter';

describe('IcpFooter', () => {
  it('shows the ICP number linking to MIIT on the filed domain', () => {
    render(<IcpFooter hostname="rmlive.cn" />);
    const link = screen.getByRole('link', { name: /粤ICP备2026081048号/ });
    expect(link).toHaveAttribute('href', 'https://beian.miit.gov.cn');
  });

  it('also shows on www subdomain', () => {
    render(<IcpFooter hostname="www.rmlive.cn" />);
    expect(screen.getByRole('link', { name: /粤ICP备/ })).toBeInTheDocument();
  });

  it.each(['rm-multiview.vercel.app', 'localhost', '8.134.153.137', 'evilrmlive.cn'])(
    'renders nothing on non-filed hosts (%s)',
    (host) => {
      const { container } = render(<IcpFooter hostname={host} />);
      expect(container).toBeEmptyDOMElement();
    },
  );
});
