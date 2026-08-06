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

  it('links the GitHub repository on every host', () => {
    render(<IcpFooter hostname="localhost" />);
    const github = screen.getByRole('link', { name: 'GitHub 项目仓库' });
    expect(github).toHaveAttribute('href', 'https://github.com/IceyWalterWhite/rm-multiview');
    expect(github).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it.each(['rm-multiview.vercel.app', 'localhost', '8.134.153.137', 'evilrmlive.cn'])(
    'hides the ICP number on non-filed hosts but keeps the footer (%s)',
    (host) => {
      render(<IcpFooter hostname={host} />);
      expect(screen.queryByRole('link', { name: /粤ICP备/ })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'GitHub 项目仓库' })).toBeInTheDocument();
    },
  );
});
