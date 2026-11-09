"""Template and origin configuration checks; no AWS or provider requests."""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/aws'))
import release_templates
from release_config import load_release_config


class DomainPreparationTests(unittest.TestCase):
    def test_existing_distribution_configuration_preserves_delivery_and_privacy(self):
        config=load_release_config();t=release_templates.foundation();r=t['Resources'];cdn=r['CDN']['Properties']['DistributionConfig']
        self.assertEqual(cdn['Aliases'],['lol.golixco.com'])
        self.assertEqual(cdn['ViewerCertificate']['AcmCertificateArn'],config['certificate_arn'])
        self.assertEqual(cdn['ViewerCertificate']['MinimumProtocolVersion'],'TLSv1.2_2021')
        self.assertEqual(cdn['Origins'][0]['OriginAccessControlId'],{'Ref':'OAC'})
        self.assertIn('WebACLId',cdn)
        self.assertEqual(r['Private']['Properties']['CorsConfiguration']['CorsRules'][0]['AllowedOrigins'],{'Ref':'AllowedOrigins'})
        self.assertEqual(t['Parameters']['AllowedOrigins']['Default'],','.join(config['allowed_origins']))
        for name in ['Site','Private','Artifacts','Jobs']:
            self.assertEqual(r[name]['DeletionPolicy'],'Retain')
        self.assertFalse(config['public_indexing'])

    def test_public_activation_keeps_preview_and_private_indexing_guard(self):
        config={**load_release_config(),'public_indexing':True}
        with patch.object(release_templates,'load_release_config',return_value=config):t=release_templates.foundation()
        r=t['Resources'];headers=r['Headers']['Properties']['ResponseHeadersPolicyConfig']['CustomHeadersConfig']['Items']
        self.assertFalse(any(x['Header']=='X-Robots-Tag' for x in headers))
        code=r['Routes']['Properties']['FunctionCode']
        self.assertIn("uri==='/robots.txt'",code)
        self.assertIn('viewer-response',json.dumps(r['CDN']))


if __name__=='__main__':unittest.main()
