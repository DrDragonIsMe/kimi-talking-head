import React from 'react';
import { AbsoluteFill, staticFile } from 'remotion';

interface BrandBadgeProps {
  brand: string;
  tagline?: string;
  primaryColor?: string;
  inline?: boolean;
}

const FONT_FAMILY = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

const BadgeContent: React.FC<{
  brand: string;
  tagline?: string;
  primaryColor?: string;
}> = ({ brand, tagline, primaryColor = '#00b498' }) => {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 18px',
        borderRadius: 14,
        background: 'rgba(10,10,18,0.72)',
        border: '1px solid rgba(255,255,255,0.1)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 12px 32px rgba(10,10,18,0.25)',
      }}
    >
      <img
        src={staticFile('logo.png')}
        alt="logo"
        style={{ width: 32, height: 32, objectFit: 'contain' }}
      />
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span
          style={{
            fontFamily: FONT_FAMILY,
            color: '#fff',
            fontSize: 20,
            fontWeight: 800,
            letterSpacing: 0.5,
            lineHeight: 1.2,
          }}
        >
          {brand}
        </span>
        {tagline ? (
          <span
            style={{
              fontFamily: FONT_FAMILY,
              color: primaryColor,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 0.5,
              marginTop: 2,
            }}
          >
            {tagline}
          </span>
        ) : null}
      </div>
    </div>
  );
};

export const BrandBadge: React.FC<BrandBadgeProps> = ({
  brand,
  tagline,
  primaryColor = '#00b498',
  inline = false,
}) => {
  if (inline) {
    return (
      <BadgeContent brand={brand} tagline={tagline} primaryColor={primaryColor} />
    );
  }

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'flex-end',
        paddingRight: 36,
        paddingBottom: 36,
        pointerEvents: 'none',
      }}
    >
      <BadgeContent brand={brand} tagline={tagline} primaryColor={primaryColor} />
    </AbsoluteFill>
  );
};
