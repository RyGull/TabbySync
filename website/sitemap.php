<?php
/**
 * sitemap.php — the XML sitemap, served at /sitemap.xml via .htaccess.
 *
 * Generated rather than written out so <lastmod> is the file's own mtime.
 * A hand-maintained sitemap.xml is a file that silently goes stale the first
 * time someone edits a page and forgets it exists, and a wrong lastmod is
 * worse than none: it teaches a crawler that this site's dates mean nothing.
 *
 * Only canonical, indexable URLs belong here — the three real pages. Not the
 * 404, not /contact?status=..., not privacy.html (which is a data file this
 * site reads, never a page it serves).
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

/** Last-modified date for one of the site's files, W3C date format. */
function sitemap_lastmod(string $file): string
{
    $path = __DIR__ . '/' . ltrim($file, '/');
    $time = is_readable($path) ? (int) filemtime($path) : 0;
    return gmdate('Y-m-d', $time > 0 ? $time : time());
}

$pages = [
    // path                 source file whose mtime dates it   priority
    ['/',                   'index.php',   '1.0'],
    [PRIVACY_PATH,          'privacy.html', '0.5'],
    [CONTACT_PATH,          'contact.php', '0.5'],
];

header('Content-Type: application/xml; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex');  // the sitemap itself is not a page

echo '<?xml version="1.0" encoding="UTF-8"?>', "\n";
?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<?php foreach ($pages as [$path, $source, $priority]): ?>
  <url>
    <loc><?= esc(abs_url($path)) ?></loc>
    <lastmod><?= esc(sitemap_lastmod($source)) ?></lastmod>
    <priority><?= esc($priority) ?></priority>
  </url>
<?php endforeach; ?>
</urlset>
