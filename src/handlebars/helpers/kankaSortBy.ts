import sortBy from '../../util/sortBy';

export default function kankaSortBy<T extends Record<string, unknown>>(data: T[], ...fieldsWithOptions: [...string[], Handlebars.HelperOptions]): T[] {
    // The last element is always the Handlebars HelperOptions — exclude it.
    const fieldNames = fieldsWithOptions.slice(0, -1).filter((f): f is string => typeof f === 'string');
    return [...data].sort(sortBy(...fieldNames));
}
