// Kapa Trader logo: gold-ringed "KA" badge and wordmark

type TBrandLogoProps = {
    width?: number;
    height?: number;
    fill?: string;
    className?: string;
};

export const BrandLogo = ({ width = 120, height = 32, fill = 'currentColor', className = '' }: TBrandLogoProps) => {
    return (
        <svg
            width={width}
            height={height}
            viewBox='0 0 120 32'
            fill='none'
            xmlns='http://www.w3.org/2000/svg'
            className={className}
            role='img'
            aria-label='Kapa Trader'
        >
            <defs>
                <radialGradient id='kapa-orb' cx='35%' cy='30%' r='80%'>
                    <stop offset='0' stopColor='#6aa2ff' />
                    <stop offset='0.5' stopColor='#2b62e8' />
                    <stop offset='1' stopColor='#163a9e' />
                </radialGradient>
            </defs>
            <circle cx='16' cy='16' r='14' fill='url(#kapa-orb)' stroke='#f5c542' strokeWidth='2' />
            <text x='16' y='20.5' textAnchor='middle' fontFamily='Arial, Helvetica, sans-serif' fontSize='11' fontWeight='800' fill='#fff'>
                KA
            </text>
            <text x='36' y='21' fontFamily='Arial, Helvetica, sans-serif' fontSize='14' fontWeight='800' letterSpacing='1' fill='#f5c542'>
                KAPA
            </text>
            <text x='80' y='21' fontFamily='Arial, Helvetica, sans-serif' fontSize='12' fontWeight='600' fill={fill}>
                Trader
            </text>
        </svg>
    );
};
